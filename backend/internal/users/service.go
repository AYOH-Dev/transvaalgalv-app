package users

import (
	"context"
	"crypto/subtle"
	"fmt"
	"strings"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
)

type Service struct {
	repository     Repository
	tokenManager   *auth.TokenManager
	bootstrapToken string
}

type AuthResult struct {
	AccessToken string    `json:"access_token"`
	ExpiresAt   time.Time `json:"expires_at"`
	User        User      `json:"user"`
}

type CreateUserInput struct {
	Email       string
	DisplayName string
	Password    string
	Role        Role
}

type UpdateUserInput struct {
	DisplayName *string
	Role        *Role
	IsActive    *bool
}

func NewService(repository Repository, tokenManager *auth.TokenManager, bootstrapToken string) *Service {
	return &Service{
		repository:     repository,
		tokenManager:   tokenManager,
		bootstrapToken: strings.TrimSpace(bootstrapToken),
	}
}

func (s *Service) BootstrapAdmin(ctx context.Context, providedToken string, input CreateUserInput) (AuthResult, error) {
	if s.bootstrapToken == "" {
		return AuthResult{}, ErrBootstrapUnavailable
	}

	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(providedToken)), []byte(s.bootstrapToken)) != 1 {
		return AuthResult{}, ErrUnauthorized
	}

	count, err := s.repository.CountUsers(ctx)
	if err != nil {
		return AuthResult{}, err
	}
	if count > 0 {
		return AuthResult{}, ErrBootstrapUnavailable
	}

	user, err := s.createUser(ctx, CreateUserInput{
		Email:       input.Email,
		DisplayName: input.DisplayName,
		Password:    input.Password,
		Role:        RoleAdmin,
	})
	if err != nil {
		return AuthResult{}, err
	}

	return s.issueToken(user)
}

func (s *Service) Login(ctx context.Context, email, password string) (AuthResult, error) {
	normalizedEmail := normalizeEmail(email)
	record, err := s.repository.GetByEmail(ctx, normalizedEmail)
	if err != nil {
		if err == ErrNotFound {
			return AuthResult{}, ErrInvalidCredentials
		}
		return AuthResult{}, err
	}

	if !record.IsActive {
		return AuthResult{}, ErrInvalidCredentials
	}

	if err := auth.ComparePassword(record.PasswordHash, password); err != nil {
		return AuthResult{}, ErrInvalidCredentials
	}

	return s.issueToken(record.User)
}

func (s *Service) CurrentUser(ctx context.Context, id string) (User, error) {
	user, err := s.repository.GetByID(ctx, id)
	if err != nil {
		return User{}, err
	}

	if !user.IsActive {
		return User{}, ErrUnauthorized
	}

	return user, nil
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	return s.repository.List(ctx)
}

func (s *Service) CreateUser(ctx context.Context, input CreateUserInput) (User, error) {
	return s.createUser(ctx, input)
}

func (s *Service) UpdateUser(ctx context.Context, id string, input UpdateUserInput) (User, error) {
	user, err := s.repository.GetByID(ctx, id)
	if err != nil {
		return User{}, err
	}

	if input.DisplayName != nil {
		displayName := strings.TrimSpace(*input.DisplayName)
		if displayName == "" {
			return User{}, fmt.Errorf("%w: display_name is required", ErrInvalidInput)
		}
		user.DisplayName = displayName
	}

	if input.Role != nil {
		if !IsValidRole(*input.Role) {
			return User{}, fmt.Errorf("%w: invalid role", ErrInvalidInput)
		}
		user.Role = *input.Role
	}

	if input.IsActive != nil {
		user.IsActive = *input.IsActive
	}

	return s.repository.Update(ctx, UpdateUserParams{
		ID:          user.ID,
		DisplayName: user.DisplayName,
		Role:        user.Role,
		IsActive:    user.IsActive,
	})
}

func (s *Service) createUser(ctx context.Context, input CreateUserInput) (User, error) {
	normalizedEmail := normalizeEmail(input.Email)
	if normalizedEmail == "" {
		return User{}, fmt.Errorf("%w: email is required", ErrInvalidInput)
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		return User{}, fmt.Errorf("%w: display_name is required", ErrInvalidInput)
	}

	role := input.Role
	if role == "" {
		role = RoleViewer
	}
	if !IsValidRole(role) {
		return User{}, fmt.Errorf("%w: invalid role", ErrInvalidInput)
	}

	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return User{}, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}

	user, err := s.repository.Create(ctx, CreateUserParams{
		Email:        normalizedEmail,
		DisplayName:  displayName,
		PasswordHash: hash,
		Role:         role,
		IsActive:     true,
	})
	if err != nil {
		return User{}, err
	}

	return user, nil
}

func (s *Service) issueToken(user User) (AuthResult, error) {
	token, expiresAt, err := s.tokenManager.Generate(auth.Subject{
		UserID: user.ID,
		Email:  user.Email,
		Role:   string(user.Role),
	})
	if err != nil {
		return AuthResult{}, err
	}

	return AuthResult{
		AccessToken: token,
		ExpiresAt:   expiresAt,
		User:        user,
	}, nil
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
