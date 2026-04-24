//go:build ignore

package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintf(os.Stderr, "usage: run_migration <migration-file>\n")
		os.Exit(1)
	}
	migrationFile := os.Args[1]

	sql, err := os.ReadFile(migrationFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading migration: %v\n", err)
		os.Exit(1)
	}

	dbURL := os.Getenv("TRANSVAAL_DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintf(os.Stderr, "TRANSVAAL_DATABASE_URL not set\n")
		os.Exit(1)
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error connecting to db: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	_, err = pool.Exec(context.Background(), string(sql))
	if err != nil {
		fmt.Fprintf(os.Stderr, "error applying migration: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Migration applied: %s\n", migrationFile)
}
