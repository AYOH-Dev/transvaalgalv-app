package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := os.Getenv("TRANSVAAL_DATABASE_URL")
	if dbURL == "" {
		fmt.Println("TRANSVAAL_DATABASE_URL not set")
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Printf("Error connecting to database: %v\n", err)
		os.Exit(1)
	}
	defer pool.Close()

	rows, err := pool.Query(ctx, "SELECT id::text, email, display_name, role FROM app_users ORDER BY created_at DESC LIMIT 10")
	if err != nil {
		fmt.Printf("Error querying users: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Printf("%-36s | %-30s | %-20s | %s\n", "ID", "Email", "Display Name", "Role")
	fmt.Println(string(make([]byte, 110)))

	for rows.Next() {
		var id, email, displayName, role string
		if err := rows.Scan(&id, &email, &displayName, &role); err != nil {
			fmt.Printf("Error scanning row: %v\n", err)
			continue
		}
		fmt.Printf("%-36s | %-30s | %-20s | %s\n", id, email, displayName, role)
	}
}
