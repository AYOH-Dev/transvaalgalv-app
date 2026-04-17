package httpapi

import (
	"net/http"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

type authResponse struct {
	AccessToken string     `json:"access_token"`
	TokenType   string     `json:"token_type"`
	ExpiresIn   int        `json:"expires_in"`
	ExpiresAt   time.Time  `json:"expires_at"`
	User        users.User `json:"user"`
}

func (a *App) handleBootstrapAdmin(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := a.users.BootstrapAdmin(r.Context(), r.Header.Get("X-Bootstrap-Token"), users.CreateUserInput{
		Email:       request.Email,
		DisplayName: request.DisplayName,
		Password:    request.Password,
	})
	if err != nil {
		mapUserError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, toAuthResponse(result, a.cfg.AccessTokenTTL))
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := a.users.Login(r.Context(), request.Email, request.Password)
	if err != nil {
		mapUserError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, toAuthResponse(result, a.cfg.AccessTokenTTL))
}

func (a *App) handleCurrentUser(w http.ResponseWriter, r *http.Request) {
	subject, ok := currentSubject(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	user, err := a.users.CurrentUser(r.Context(), subject.UserID)
	if err != nil {
		mapUserError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, user)
}

func toAuthResponse(result users.AuthResult, ttl time.Duration) authResponse {
	return authResponse{
		AccessToken: result.AccessToken,
		TokenType:   "Bearer",
		ExpiresIn:   int(ttl.Seconds()),
		ExpiresAt:   result.ExpiresAt,
		User:        result.User,
	}
}
