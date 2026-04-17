package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"os"
	"time"
)

const postgresSSLRequestCode = 80877103

func main() {
	listenAddr := getenv("DEV_DB_PROXY_LISTEN_ADDR", "127.0.0.1:6543")
	targetAddr := os.Getenv("DEV_DB_PROXY_TARGET_ADDR")
	if targetAddr == "" {
		log.Fatal("DEV_DB_PROXY_TARGET_ADDR is required")
	}

	tlsConfig, err := newTLSConfig()
	if err != nil {
		log.Fatalf("create tls config: %v", err)
	}

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("listen on %s: %v", listenAddr, err)
	}
	defer listener.Close()

	log.Printf("dev db proxy listening on %s and forwarding to %s", listenAddr, targetAddr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept connection: %v", err)
			continue
		}

		go handleConn(conn, targetAddr, tlsConfig)
	}
}

func handleConn(client net.Conn, targetAddr string, tlsConfig *tls.Config) {
	defer client.Close()

	if err := client.SetDeadline(time.Now().Add(10 * time.Second)); err != nil {
		log.Printf("set initial deadline: %v", err)
		return
	}

	request := make([]byte, 8)
	if _, err := io.ReadFull(client, request); err != nil {
		log.Printf("read ssl request: %v", err)
		return
	}

	if binary.BigEndian.Uint32(request[:4]) != 8 || binary.BigEndian.Uint32(request[4:]) != postgresSSLRequestCode {
		log.Printf("unexpected initial postgres message from %s", client.RemoteAddr())
		_, _ = client.Write([]byte{'N'})
		return
	}

	if _, err := client.Write([]byte{'S'}); err != nil {
		log.Printf("write ssl acknowledgement: %v", err)
		return
	}

	tlsClient := tls.Server(client, tlsConfig)
	if err := tlsClient.Handshake(); err != nil {
		log.Printf("tls handshake: %v", err)
		return
	}
	defer tlsClient.Close()

	if err := tlsClient.SetDeadline(time.Time{}); err != nil {
		log.Printf("clear client deadline: %v", err)
		return
	}

	upstream, err := net.DialTimeout("tcp", targetAddr, 10*time.Second)
	if err != nil {
		log.Printf("dial upstream %s: %v", targetAddr, err)
		return
	}
	defer upstream.Close()

	errCh := make(chan error, 2)
	go proxyCopy(upstream, tlsClient, errCh)
	go proxyCopy(tlsClient, upstream, errCh)

	<-errCh
	_ = upstream.Close()
	_ = tlsClient.Close()
	<-errCh
}

func proxyCopy(dst io.Writer, src io.Reader, errCh chan<- error) {
	_, err := io.Copy(dst, src)
	errCh <- err
}

func newTLSConfig() (*tls.Config, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate private key: %w", err)
	}

	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, fmt.Errorf("generate serial number: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  time.Now().Add(24 * time.Hour),
		KeyUsage:  x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
		DNSNames:    []string{"localhost"},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		return nil, fmt.Errorf("create certificate: %w", err)
	}

	certificate := tls.Certificate{
		Certificate: [][]byte{derBytes},
		PrivateKey:  privateKey,
	}

	return &tls.Config{
		Certificates: []tls.Certificate{certificate},
		MinVersion:   tls.VersionTLS12,
	}, nil
}

func getenv(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
