package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	AppName               string
	Environment           string
	Port                  string
	PublicBaseURL         string
	AccessTokenTTL        time.Duration
	DatabaseURL           string
	JWTSecret             string
	BootstrapAdminToken   string
	DocuWareBaseURL       string
	DocuWareFileCabinetID string
}

func Load() (Config, error) {
	accessTokenTTL, err := time.ParseDuration(getenv("ACCESS_TOKEN_TTL", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("invalid ACCESS_TOKEN_TTL: %w", err)
	}

	cfg := Config{
		AppName:               "transvaalgalv-app",
		Environment:           getenv("APP_ENV", "development"),
		Port:                  getenv("PORT", "8080"),
		PublicBaseURL:         getenv("PUBLIC_BASE_URL", "https://transvaal.ayai.live"),
		AccessTokenTTL:        accessTokenTTL,
		DatabaseURL:           os.Getenv("TRANSVAAL_DATABASE_URL"),
		JWTSecret:             os.Getenv("JWT_SECRET"),
		BootstrapAdminToken:   os.Getenv("BOOTSTRAP_ADMIN_TOKEN"),
		DocuWareBaseURL:       os.Getenv("DOCUWARE_BASE_URL"),
		DocuWareFileCabinetID: os.Getenv("DOCUWARE_FILE_CABINET_ID"),
	}

	if err := validateDatabaseURL(cfg.DatabaseURL); err != nil {
		return Config{}, err
	}

	if err := validateSecret("JWT_SECRET", cfg.JWTSecret, true); err != nil {
		return Config{}, err
	}

	if err := validateSecret("BOOTSTRAP_ADMIN_TOKEN", cfg.BootstrapAdminToken, false); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func validateDatabaseURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("TRANSVAAL_DATABASE_URL is required")
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid TRANSVAAL_DATABASE_URL: %w", err)
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "postgres" && scheme != "postgresql" {
		return fmt.Errorf("TRANSVAAL_DATABASE_URL must use postgres or postgresql")
	}

	if parsed.Query().Get("sslmode") != "require" {
		return fmt.Errorf("TRANSVAAL_DATABASE_URL must include sslmode=require")
	}

	return nil
}

func validateSecret(name, secret string, required bool) error {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		if required {
			return fmt.Errorf("%s is required", name)
		}
		return nil
	}

	if len(secret) < 32 {
		return fmt.Errorf("%s must be at least 32 characters", name)
	}

	return nil
}
