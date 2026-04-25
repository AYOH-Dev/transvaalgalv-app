package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/docuware"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/httpapi"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/postgres"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/receiving"
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
	receivingRepository := receiving.NewRepository(dbPool)
	receivingService := receiving.NewService(receivingRepository)

	// Initialize DocuWare sync worker if credentials are present
	var syncWorker *docuware.Worker
	if cfg.DocuWareBaseURL != "" && cfg.DocuWareFileCabinetID != "" && cfg.DocuWareUsername != "" && cfg.DocuWarePassword != "" {
		docuwareClient := docuware.NewClient(cfg.DocuWareBaseURL, cfg.DocuWareFileCabinetID, cfg.DocuWareUsername, cfg.DocuWarePassword)
		syncWorker = docuware.NewWorker(dbPool, docuwareClient, *log.Default(), cfg.DocuWareSyncInterval, cfg.DocuWareSyncMaxWorkers)
		receivingService.SetSyncEnqueuer(syncWorker)

		// Start sync worker in background
		syncCtx, syncCancel := context.WithCancel(context.Background())
		go syncWorker.Start(syncCtx)
		defer syncCancel()

		log.Printf("docuware sync worker initialized (base_url=%s, cabinet=%s)", cfg.DocuWareBaseURL, cfg.DocuWareFileCabinetID)
	} else {
		log.Printf("docuware sync worker disabled (missing credentials)")
	}

	server := httpapi.NewServer(cfg, userService, receivingService, tokenManager)
	log.Printf("starting %s on :%s", cfg.AppName, cfg.Port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}
