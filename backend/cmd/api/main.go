package main

import (
	"errors"
	"log"
	"net/http"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/httpapi"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	server := httpapi.NewServer(cfg)
	log.Printf("starting %s on :%s", cfg.AppName, cfg.Port)

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}
