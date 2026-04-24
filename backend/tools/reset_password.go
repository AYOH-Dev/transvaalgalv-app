//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintf(os.Stderr, "usage: reset_password <email> <new-password>\n")
		os.Exit(1)
	}
	email := os.Args[1]
	password := os.Args[2]

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error hashing password: %v\n", err)
		os.Exit(1)
	}

	dbURL := os.Getenv("TRANSVAAL_DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintf(os.Stderr, "TRANSVAAL_DATABASE_URL not set\n")
		os.Exit(1)
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "connect: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	tag, err := pool.Exec(context.Background(),
		"UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE email = $2",
		hash, email,
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "update: %v\n", err)
		os.Exit(1)
	}
	if tag.RowsAffected() == 0 {
		fmt.Fprintf(os.Stderr, "no user found with email %q\n", email)
		os.Exit(1)
	}

	fmt.Printf("Password reset for %s\n", email)
}
