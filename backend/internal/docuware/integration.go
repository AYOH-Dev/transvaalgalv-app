package docuware

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha512"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// IntegrationConfig holds everything the official DocuWare Integration URL
// builder needs. The passphrase is provided base64-encoded (matching the
// "passphrase64" parameter in DocuWare's reference scripts) — the raw bytes
// are SHA-512'd to derive a 32-byte AES-256 key and 16-byte CBC IV.
type IntegrationConfig struct {
	ServerURL        string // e.g. https://transgalv.docuware.cloud
	PassphraseBase64 string
	Username         string
	Password         string
	CabinetID        string
	ResultDialogID   string
}

// Configured reports whether all parameters needed to build a viewer URL are set.
func (c IntegrationConfig) Configured() bool {
	return c.ServerURL != "" &&
		c.PassphraseBase64 != "" &&
		c.Username != "" &&
		c.Password != "" &&
		c.CabinetID != "" &&
		c.ResultDialogID != ""
}

// IntegrationMode is the "p=" parameter from the DocuWare integration URL spec.
type IntegrationMode string

const (
	ModeViewer     IntegrationMode = "V"
	ModeDownload   IntegrationMode = "D"
	ModeResultList IntegrationMode = "RVL"
)

// BuildIntegrationURL produces a DocuWare WebClient Integration URL that,
// when opened, runs the supplied query against the configured cabinet and
// renders the matching document(s) in the chosen mode.
//
// The query is a DocuWare condition expression like `[DWDOCID] = "12345"`.
// We do not validate the query — DocuWare will report syntax errors when
// the URL is opened.
func BuildIntegrationURL(cfg IntegrationConfig, mode IntegrationMode, query string) (string, error) {
	if !cfg.Configured() {
		return "", errors.New("docuware integration is not configured")
	}
	if query == "" {
		return "", errors.New("query is empty")
	}

	key, iv, err := deriveKeyIV(cfg.PassphraseBase64)
	if err != nil {
		return "", err
	}

	loginClause := fmt.Sprintf("User=%s\\nPwd=%s", cfg.Username, cfg.Password)
	loginToken := urlTokenEncode([]byte(loginClause))
	queryToken := urlTokenEncode([]byte(query))

	params := fmt.Sprintf(
		"p=%s&lc=%s&fc=%s&rl=%s&q=%s",
		string(mode),
		loginToken,
		cfg.CabinetID,
		cfg.ResultDialogID,
		queryToken,
	)

	cipherText, err := encryptAESCBC(key, iv, []byte(params))
	if err != nil {
		return "", err
	}

	ep := convertToURLTokenFormat(base64.StdEncoding.EncodeToString(cipherText))
	return fmt.Sprintf("%s/DocuWare/Platform/WebClient/1/Integration?ep=%s",
		strings.TrimRight(cfg.ServerURL, "/"), ep), nil
}

// deriveKeyIV mirrors the JS reference: base64-decode the passphrase, SHA-512
// the raw bytes, take the first 32 as the AES key and the next 16 as the IV.
func deriveKeyIV(passphraseB64 string) ([]byte, []byte, error) {
	raw, err := base64.StdEncoding.DecodeString(passphraseB64)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid base64 passphrase: %w", err)
	}
	sum := sha512.Sum512(raw)
	return sum[:32], sum[32:48], nil
}

// encryptAESCBC AES-256-CBC encrypts plain with PKCS#7 padding.
func encryptAESCBC(key, iv, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	bs := block.BlockSize()
	pad := bs - (len(plain) % bs)
	padded := make([]byte, len(plain)+pad)
	copy(padded, plain)
	for i := len(plain); i < len(padded); i++ {
		padded[i] = byte(pad)
	}
	out := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, padded)
	return out, nil
}

// urlTokenEncode is .NET's HttpServerUtility.UrlTokenEncode equivalent, applied
// to a byte slice. Reproduces the JS reference's behaviour exactly:
//   - standard base64-encode the bytes
//   - walk every character; swap '+' → '-', '/' → '_', leave '=' alone
//   - replace the trailing '=' run with a single digit equal to its length
func urlTokenEncode(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	b64 := base64.StdEncoding.EncodeToString(raw)
	endPos := len(b64)
	for endPos > 0 && b64[endPos-1] == '=' {
		endPos--
	}
	padCount := len(b64) - endPos

	var b strings.Builder
	b.Grow(endPos + 1)
	for i := 0; i < endPos; i++ {
		switch b64[i] {
		case '+':
			b.WriteByte('-')
		case '/':
			b.WriteByte('_')
		default:
			b.WriteByte(b64[i])
		}
	}
	// Suffix the trailing-padding count as a single digit (0–2 in practice for
	// base64). DocuWare's integration endpoint reverses this on its side.
	b.WriteByte('0' + byte(padCount))
	return b.String()
}

// convertToURLTokenFormat applies the same trailing-padding+swap transform but
// to an already-base64-encoded string (used on the AES ciphertext output).
func convertToURLTokenFormat(b64 string) string {
	padCount := 0
	for i := len(b64) - 1; i >= 0 && b64[i] == '='; i-- {
		padCount++
	}
	stripped := strings.TrimRight(b64, "=")
	swapped := strings.NewReplacer("+", "-", "/", "_").Replace(stripped)
	return swapped + fmt.Sprintf("%d", padCount)
}
