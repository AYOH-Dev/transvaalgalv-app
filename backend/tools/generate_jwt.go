package main

import (
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type tokenClaims struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

func main() {
	if len(os.Args) < 5 {
		fmt.Fprintf(os.Stderr, "usage: generate_jwt <secret> <user_id> <email> <role>\n")
		os.Exit(2)
	}
	secret := os.Args[1]
	userID := os.Args[2]
	email := os.Args[3]
	role := os.Args[4]

	expiresAt := time.Now().Add(24 * time.Hour).UTC()
	claims := tokenClaims{
		Email: email,
		Role:  role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error signing token: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("%s\n", signed)
}
