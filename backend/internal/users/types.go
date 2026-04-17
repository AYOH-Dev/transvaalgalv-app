package users

import (
	"errors"
	"time"
)

type Role string

const (
	RoleAdmin          Role = "admin"
	RoleOperationsLead Role = "operations_lead"
	RoleReceiver       Role = "receiver"
	RoleReviewer       Role = "reviewer"
	RoleViewer         Role = "viewer"
)

var (
	ErrNotFound             = errors.New("user not found")
	ErrConflict             = errors.New("user already exists")
	ErrInvalidInput         = errors.New("invalid input")
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrUnauthorized         = errors.New("unauthorized")
	ErrBootstrapUnavailable = errors.New("bootstrap unavailable")
)

type User struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        Role      `json:"role"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type userRecord struct {
	User
	PasswordHash string
}

type CreateUserParams struct {
	Email        string
	DisplayName  string
	PasswordHash string
	Role         Role
	IsActive     bool
}

type UpdateUserParams struct {
	ID          string
	DisplayName string
	Role        Role
	IsActive    bool
}

func IsValidRole(role Role) bool {
	switch role {
	case RoleAdmin, RoleOperationsLead, RoleReceiver, RoleReviewer, RoleViewer:
		return true
	default:
		return false
	}
}
