package users

import (
	"context"
	"testing"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/auth"
)

type fakeRepository struct {
	count int
	user  userRecord
}

func (f *fakeRepository) CountUsers(context.Context) (int, error) { return f.count, nil }
func (f *fakeRepository) GetByEmail(context.Context, string) (userRecord, error) {
	if f.user.ID == "" {
		return userRecord{}, ErrNotFound
	}
	return f.user, nil
}
func (f *fakeRepository) GetByID(context.Context, string) (User, error) {
	if f.user.ID == "" {
		return User{}, ErrNotFound
	}
	return f.user.User, nil
}
func (f *fakeRepository) List(context.Context) ([]User, error) {
	if f.user.ID == "" {
		return []User{}, nil
	}
	return []User{f.user.User}, nil
}
func (f *fakeRepository) Create(context.Context, CreateUserParams) (User, error) {
	return User{ID: "user-1", Email: "admin@example.com", DisplayName: "Admin", Role: RoleAdmin, IsActive: true}, nil
}
func (f *fakeRepository) Update(context.Context, UpdateUserParams) (User, error) {
	return f.user.User, nil
}

func TestBootstrapAdminRequiresMatchingToken(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository, auth.NewTokenManager("12345678901234567890123456789012", 15*time.Minute), "bootstrap-token-12345678901234567890")

	_, err := service.BootstrapAdmin(context.Background(), "wrong-token", CreateUserInput{
		Email:       "admin@example.com",
		DisplayName: "Admin",
		Password:    "123456789012",
	})
	if err != ErrUnauthorized {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}

func TestLoginReturnsInvalidCredentialsForUnknownUser(t *testing.T) {
	repository := &fakeRepository{}
	service := NewService(repository, auth.NewTokenManager("12345678901234567890123456789012", 15*time.Minute), "")

	_, err := service.Login(context.Background(), "missing@example.com", "123456789012")
	if err != ErrInvalidCredentials {
		t.Fatalf("err = %v, want ErrInvalidCredentials", err)
	}
}
