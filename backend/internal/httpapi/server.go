package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

type App struct {
	cfg          config.Config
	users        *users.Service
	tokenManager *auth.TokenManager
}

func NewServer(cfg config.Config, userService *users.Service, tokenManager *auth.TokenManager) *http.Server {
	app := &App{
		cfg:          cfg,
		users:        userService,
		tokenManager: tokenManager,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", healthHandler(cfg))
	mux.HandleFunc("GET /ready", readyHandler(cfg))
	mux.HandleFunc("POST /auth/bootstrap-admin", app.handleBootstrapAdmin)
	mux.HandleFunc("POST /auth/login", app.handleLogin)
	mux.Handle("GET /auth/me", app.requireAuth(http.HandlerFunc(app.handleCurrentUser)))
	mux.Handle("GET /admin/users", app.requireAdmin(http.HandlerFunc(app.handleListUsers)))
	mux.Handle("POST /admin/users", app.requireAdmin(http.HandlerFunc(app.handleCreateUser)))
	mux.Handle("PATCH /admin/users/{id}", app.requireAdmin(http.HandlerFunc(app.handleUpdateUser)))

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
