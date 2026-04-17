package httpapi

import (
	"net/http"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
)

func healthHandler(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":      "ok",
			"service":     cfg.AppName,
			"environment": cfg.Environment,
		})
	}
}

func readyHandler(cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"service":       cfg.AppName,
			"database":      cfg.DatabaseURL != "",
			"docuware":      cfg.DocuWareBaseURL != "",
			"archive_layer": "docuware",
		})
	}
}
