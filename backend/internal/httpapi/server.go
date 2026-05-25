package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/receiving"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

type PhotoEnqueuer interface {
	NotifyPendingPhoto(ctx context.Context, photoID string) error
}

type App struct {
	cfg           config.Config
	users         *users.Service
	receiving     *receiving.Service
	photos        *receiving.PhotoService
	photoEnqueuer PhotoEnqueuer
	tokenManager  *auth.TokenManager
}

func NewServer(cfg config.Config, userService *users.Service, receivingService *receiving.Service, photoService *receiving.PhotoService, photoEnqueuer PhotoEnqueuer, tokenManager *auth.TokenManager) *http.Server {
	app := &App{
		cfg:           cfg,
		users:         userService,
		receiving:     receivingService,
		photos:        photoService,
		photoEnqueuer: photoEnqueuer,
		tokenManager:  tokenManager,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler(cfg))
	mux.HandleFunc("GET /ready", readyHandler(cfg))
	mux.HandleFunc("POST /auth/bootstrap-admin", app.handleBootstrapAdmin)
	mux.HandleFunc("POST /auth/login", app.handleLogin)
	mux.Handle("GET /auth/me", app.requireAuth(http.HandlerFunc(app.handleCurrentUser)))
	mux.Handle("POST /grns", app.requireReceiverOrAdmin(http.HandlerFunc(app.handleCreateGRN)))
	mux.Handle("GET /receipts", app.requireAuth(http.HandlerFunc(app.handleListReceipts)))
	mux.Handle("GET /receipts/{id}", app.requireAuth(http.HandlerFunc(app.handleGetReceipt)))
	mux.Handle("GET /receipts/{id}/pod-link", app.requireAuth(http.HandlerFunc(app.handleGetReceiptPODLink)))
	mux.Handle("POST /receipts/{id}/sync-docuware", app.requireAuth(http.HandlerFunc(app.handleSyncReceiptLineDocuWare)))
	mux.Handle("PATCH /receipts/{id}/lines/{lineId}", app.requireAuth(http.HandlerFunc(app.handleUpdateReceiptLine)))
	mux.Handle("POST /receipts/{id}/lines/bulk-update", app.requireAuth(http.HandlerFunc(app.handleBulkUpdateReceiptLines)))
	mux.Handle("POST /receipts/{id}/lines/{lineId}/photos", app.requireReceiverOrAdmin(http.HandlerFunc(app.handleUploadDefectPhoto)))
	mux.Handle("GET /receipts/{id}/photos/{photoId}", app.requireAuth(http.HandlerFunc(app.handleGetDefectPhoto)))
	mux.Handle("DELETE /receipts/{id}/photos/{photoId}", app.requireReceiverOrAdmin(http.HandlerFunc(app.handleDeleteDefectPhoto)))
	mux.Handle("GET /receipts/{id}/grn", app.requireAuth(http.HandlerFunc(app.handleGetGRN)))
	mux.Handle("PATCH /receipts/{id}", app.requireAuth(http.HandlerFunc(app.handleUpdateReceipt)))
	mux.Handle("GET /admin/users", app.requireReceiverOrAdmin(http.HandlerFunc(app.handleListUsers)))
	mux.Handle("POST /admin/users", app.requireReceiverOrAdmin(http.HandlerFunc(app.handleCreateUser)))
	mux.Handle("PATCH /admin/users/{id}", app.requireAdmin(http.HandlerFunc(app.handleUpdateUser)))
	mux.Handle("POST /integrations/docuware/imports", app.requireDocuWareImportAuth(http.HandlerFunc(app.handleImportDocuWareRows)))

	return &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      securityHeaders(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
