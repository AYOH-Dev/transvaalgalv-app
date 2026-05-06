package main

import (
	"fmt"
	"os"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
)

func main() {
	if len(os.Args) < 5 {
		fmt.Fprintf(os.Stderr, "usage: generate_token <secret> <user_id> <email> <role>\n")
		os.Exit(2)
	}

	secret := os.Args[1]
	userID := os.Args[2]
	email := os.Args[3]
	role := os.Args[4]

	tm := auth.NewTokenManager(secret, 24*time.Hour)
	token, exp, err := tm.Generate(auth.Subject{UserID: userID, Email: email, Role: role})
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("token=%s\nexpires_at=%s\n", token, exp.UTC().Format(time.RFC3339))
}
