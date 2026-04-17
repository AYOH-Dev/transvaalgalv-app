package httpapi

import (
	"net/http"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

func (a *App) handleListUsers(w http.ResponseWriter, r *http.Request) {
	result, err := a.users.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count": len(result),
		"users": result,
	})
}

func (a *App) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		Password    string `json:"password"`
		Role        string `json:"role"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := a.users.CreateUser(r.Context(), users.CreateUserInput{
		Email:       request.Email,
		DisplayName: request.DisplayName,
		Password:    request.Password,
		Role:        users.Role(request.Role),
	})
	if err != nil {
		mapUserError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, user)
}

func (a *App) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	var request struct {
		DisplayName *string `json:"display_name"`
		Role        *string `json:"role"`
		IsActive    *bool   `json:"is_active"`
	}

	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var role *users.Role
	if request.Role != nil {
		parsed := users.Role(*request.Role)
		role = &parsed
	}

	user, err := a.users.UpdateUser(r.Context(), r.PathValue("id"), users.UpdateUserInput{
		DisplayName: request.DisplayName,
		Role:        role,
		IsActive:    request.IsActive,
	})
	if err != nil {
		mapUserError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, user)
}
