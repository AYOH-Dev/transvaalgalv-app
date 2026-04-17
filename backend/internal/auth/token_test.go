package auth

import (
	"testing"
	"time"
)

func TestTokenManagerRoundTrip(t *testing.T) {
	manager := NewTokenManager("12345678901234567890123456789012", 15*time.Minute)
	token, _, err := manager.Generate(Subject{
		UserID: "user-1",
		Email:  "user@example.com",
		Role:   "admin",
	})
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	subject, err := manager.Parse(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if subject.UserID != "user-1" {
		t.Fatalf("subject.UserID = %q, want user-1", subject.UserID)
	}

	if subject.Role != "admin" {
		t.Fatalf("subject.Role = %q, want admin", subject.Role)
	}
}
