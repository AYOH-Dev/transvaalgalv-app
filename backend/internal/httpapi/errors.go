package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeJSON(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return fmt.Errorf("decode json: %w", err)
	}
	return nil
}

func mapUserError(w http.ResponseWriter, err error) {
	switch err {
	case users.ErrUnauthorized:
		writeError(w, http.StatusUnauthorized, "unauthorized")
	case users.ErrInvalidCredentials:
		writeError(w, http.StatusUnauthorized, "invalid email or password")
	case users.ErrBootstrapUnavailable:
		writeError(w, http.StatusConflict, "bootstrap admin is unavailable")
	case users.ErrConflict:
		writeError(w, http.StatusConflict, "user with that email already exists")
	case users.ErrNotFound:
		writeError(w, http.StatusNotFound, "user not found")
	case nil:
		return
	default:
		if errors.Is(err, users.ErrInvalidInput) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}

		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
