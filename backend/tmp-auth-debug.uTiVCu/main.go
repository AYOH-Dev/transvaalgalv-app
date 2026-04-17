package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
    "github.com/AYOH-Dev/transvaalgalv-app/backend/internal/postgres"
    "github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

func main() {
    databaseURL := os.Getenv("TRANSVAAL_DATABASE_URL")
    if databaseURL == "" {
        panic("TRANSVAAL_DATABASE_URL is required")
    }

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    pool, err := postgres.Open(ctx, databaseURL)
    if err != nil {
        panic(err)
    }
    defer pool.Close()

    repo := users.NewRepository(pool)

    count, err := repo.CountUsers(ctx)
    fmt.Printf("count=%d err=%v\n", count, err)

    record, err := repo.GetByEmail(ctx, "dev-admin@transvaal.local")
    fmt.Printf("getByEmail record=%+v err=%v\n", record, err)

    hash, err := auth.HashPassword("DebugUserPass123!")
    fmt.Printf("hash err=%v\n", err)
    if err != nil {
        return
    }

    user, err := repo.Create(ctx, users.CreateUserParams{
        Email:        fmt.Sprintf("debug-%d@transvaal.local", time.Now().UnixNano()),
        DisplayName:  "Debug User",
        PasswordHash: hash,
        Role:         users.RoleViewer,
        IsActive:     true,
    })
    fmt.Printf("create user=%+v err=%v\n", user, err)
}
