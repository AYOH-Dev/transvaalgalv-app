package httpapi

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

type contextKey string

const authSubjectContextKey contextKey = "auth-subject"

func (a *App) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r.Header.Get("Authorization"))
		if !ok {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}

		subject, err := a.tokenManager.Parse(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid bearer token")
			return
		}

		ctx := context.WithValue(r.Context(), authSubjectContextKey, subject)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (a *App) requireAdmin(next http.Handler) http.Handler {
	return a.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subject, ok := currentSubject(r.Context())
		if !ok || users.Role(subject.Role) != users.RoleAdmin {
			writeError(w, http.StatusForbidden, "admin access required")
			return
		}

		next.ServeHTTP(w, r)
	}))
}

func (a *App) requireReceiverOrAdmin(next http.Handler) http.Handler {
	return a.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		subject, ok := currentSubject(r.Context())
		if !ok {
			writeError(w, http.StatusForbidden, "receiver or admin access required")
			return
		}
		role := users.Role(subject.Role)
		if role != users.RoleAdmin && role != users.RoleReceiver {
			writeError(w, http.StatusForbidden, "receiver or admin access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (a *App) requireDocuWareImportAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.hasDocuWarePushBasicAuth() {
			writeError(w, http.StatusServiceUnavailable, "docuware import basic auth is not configured")
			return
		}

		username, password, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="docuware-import"`)
			writeError(w, http.StatusUnauthorized, "missing basic auth credentials")
			return
		}

		if !a.matchesDocuWarePushBasicAuth(username, password) {
			w.Header().Set("WWW-Authenticate", `Basic realm="docuware-import"`)
			writeError(w, http.StatusUnauthorized, "invalid basic auth credentials")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (a *App) hasDocuWarePushBasicAuth() bool {
	return strings.TrimSpace(a.cfg.DocuWarePushUsername) != "" && strings.TrimSpace(a.cfg.DocuWarePushPassword) != ""
}

func (a *App) matchesDocuWarePushBasicAuth(username, password string) bool {
	return subtle.ConstantTimeCompare([]byte(strings.TrimSpace(username)), []byte(a.cfg.DocuWarePushUsername)) == 1 &&
		subtle.ConstantTimeCompare([]byte(strings.TrimSpace(password)), []byte(a.cfg.DocuWarePushPassword)) == 1
}

func currentSubject(ctx context.Context) (auth.Subject, bool) {
	subject, ok := ctx.Value(authSubjectContextKey).(auth.Subject)
	return subject, ok
}

func bearerToken(header string) (string, bool) {
	parts := strings.SplitN(strings.TrimSpace(header), " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", false
	}

	return strings.TrimSpace(parts[1]), true
}
