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
	photoService := receiving.NewPhotoService(receivingRepository, cfg.PhotoStorageDir, cfg.PhotoMaxBytes)
	grnService := receiving.NewGRNService(receivingRepository, cfg.PhotoStorageDir, receiving.TransvaalCompany)

	// Initialize DocuWare sync worker if credentials are present
	var syncWorker *docuware.Worker
	var photoEnqueuer httpapi.PhotoEnqueuer
	if cfg.DocuWareBaseURL != "" && cfg.DocuWareFileCabinetID != "" && cfg.DocuWareUsername != "" && cfg.DocuWarePassword != "" {
		docuwareClient := docuware.NewClient(cfg.DocuWareBaseURL, cfg.DocuWareFileCabinetID, cfg.DocuWareUsername, cfg.DocuWarePassword)
		syncWorker = docuware.NewWorker(dbPool, docuwareClient, *log.Default(), cfg.DocuWareSyncInterval, cfg.DocuWareSyncMaxWorkers)
		syncWorker.SetPhotoStorageDir(cfg.PhotoStorageDir)
		syncWorker.SetDocumentsCabinet(cfg.DocuWarePODCabinetID)
		receivingService.SetSyncEnqueuer(syncWorker)
		receivingService.SetGRNService(grnService, func(_ string) { syncWorker.NotifyPendingGRN("") })
		receivingService.SetPODStatusEnqueuer(syncWorker)
		photoEnqueuer = syncWorker

		// Start sync worker in background
		syncCtx, syncCancel := context.WithCancel(context.Background())
		go syncWorker.Start(syncCtx)
		defer syncCancel()

		log.Printf("docuware sync worker initialized (base_url=%s, cabinet=%s)", cfg.DocuWareBaseURL, cfg.DocuWareFileCabinetID)
	} else {
		log.Printf("docuware sync worker disabled (missing credentials)")
		// Still wire GRN generation so the PDF is produced and stored locally,
		// even if the DocuWare push is offline.
		receivingService.SetGRNService(grnService, nil)
	}

	// Auto-archive: promote 'matched' receipts older than ARCHIVE_AFTER_DAYS
	// into 'archived'. Runs hourly in the background; archived receipts stay
	// in the DB but are hidden from default list views.
	archiveCtx, archiveCancel := context.WithCancel(context.Background())
	go receivingService.RunArchiveLoop(archiveCtx, cfg.ArchiveAfter, time.Hour)
	defer archiveCancel()

	server := httpapi.NewServer(cfg, userService, receivingService, photoService, photoEnqueuer, tokenManager)
	log.Printf("starting %s on :%s", cfg.AppName, cfg.Port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}
