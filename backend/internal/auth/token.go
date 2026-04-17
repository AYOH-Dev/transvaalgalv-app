package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type Subject struct {
	UserID string
	Email  string
	Role   string
}

type TokenManager struct {
	secret []byte
	ttl    time.Duration
}

type tokenClaims struct {
	Email string `json:"email"`
	Role  string `json:"role"`
	jwt.RegisteredClaims
}

func NewTokenManager(secret string, ttl time.Duration) *TokenManager {
	return &TokenManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

func (m *TokenManager) Generate(subject Subject) (string, time.Time, error) {
	expiresAt := time.Now().Add(m.ttl).UTC()
	claims := tokenClaims{
		Email: subject.Email,
		Role:  subject.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   subject.UserID,
			IssuedAt:  jwt.NewNumericDate(time.Now().UTC()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign token: %w", err)
	}

	return signed, expiresAt, nil
}

func (m *TokenManager) Parse(raw string) (Subject, error) {
	claims := &tokenClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}

		return m.secret, nil
	})
	if err != nil {
		return Subject{}, fmt.Errorf("parse token: %w", err)
	}

	if !token.Valid {
		return Subject{}, fmt.Errorf("invalid token")
	}

	return Subject{
		UserID: claims.Subject,
		Email:  claims.Email,
		Role:   claims.Role,
	}, nil
}

func (m *TokenManager) TTL() time.Duration {
	return m.ttl
}
