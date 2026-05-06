package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
)

func TestHealthHandler(t *testing.T) {
	cfg := config.Config{AppName: "transvaalgalv-app", Environment: "test"}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()

	healthHandler(cfg).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status code = %d, want %d", recorder.Code, http.StatusOK)
	}

	response := map[string]string{}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if response["service"] != cfg.AppName {
		t.Fatalf("service = %q, want %q", response["service"], cfg.AppName)
	}

	if response["status"] != "ok" {
		t.Fatalf("status = %q, want ok", response["status"])
	}
}

func TestServerSecurityHeaders(t *testing.T) {
	cfg := config.Config{AppName: "transvaalgalv-app", Environment: "test", Port: "8080"}
	server := NewServer(cfg, nil, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()

	server.Handler.ServeHTTP(recorder, req)

	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", recorder.Header().Get("X-Content-Type-Options"))
	}

	if recorder.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", recorder.Header().Get("X-Frame-Options"))
	}
}
