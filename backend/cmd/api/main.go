package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/httpapi"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/postgres"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	dbPool, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer dbPool.Close()

	tokenManager := auth.NewTokenManager(cfg.JWTSecret, cfg.AccessTokenTTL)
	userRepository := users.NewRepository(dbPool)
	userService := users.NewService(userRepository, tokenManager, cfg.BootstrapAdminToken)

	server := httpapi.NewServer(cfg, userService, tokenManager)
	log.Printf("starting %s on :%s", cfg.AppName, cfg.Port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}
