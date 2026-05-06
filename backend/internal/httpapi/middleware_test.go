package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/config"
)

func TestRequireDocuWareImportAuthAllowsBasicAuth(t *testing.T) {
	app := &App{cfg: config.Config{DocuWarePushUsername: "docuware_push", DocuWarePushPassword: "super-secret-password"}}
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", nil)
	req.SetBasicAuth("docuware_push", "super-secret-password")
	recorder := httptest.NewRecorder()
	called := false

	app.requireDocuWareImportAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status code = %d, want %d", recorder.Code, http.StatusNoContent)
	}

	if !called {
		t.Fatal("expected next handler to be called")
	}
}

func TestRequireDocuWareImportAuthRejectsInvalidBasicAuth(t *testing.T) {
	app := &App{cfg: config.Config{DocuWarePushUsername: "docuware_push", DocuWarePushPassword: "super-secret-password"}}
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", nil)
	req.SetBasicAuth("docuware_push", "wrong-password")
	recorder := httptest.NewRecorder()

	app.requireDocuWareImportAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status code = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}

	if recorder.Header().Get("WWW-Authenticate") != `Basic realm="docuware-import"` {
		t.Fatalf("WWW-Authenticate = %q", recorder.Header().Get("WWW-Authenticate"))
	}
}

func TestRequireDocuWareImportAuthRejectsMissingBasicAuth(t *testing.T) {
	app := &App{cfg: config.Config{DocuWarePushUsername: "docuware_push", DocuWarePushPassword: "super-secret-password"}}
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", nil)
	recorder := httptest.NewRecorder()

	app.requireDocuWareImportAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status code = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}

	if recorder.Header().Get("WWW-Authenticate") != `Basic realm="docuware-import"` {
		t.Fatalf("WWW-Authenticate = %q", recorder.Header().Get("WWW-Authenticate"))
	}
}

func TestRequireDocuWareImportAuthRejectsWhenNotConfigured(t *testing.T) {
	app := &App{cfg: config.Config{}}
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", nil)
	recorder := httptest.NewRecorder()

	app.requireDocuWareImportAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status code = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
}
