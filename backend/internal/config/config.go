package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	AppName               string
	Environment           string
	Port                  string
	PublicBaseURL         string
	DatabaseURL           string
	DocuWareBaseURL       string
	DocuWareFileCabinetID string
}

func Load() (Config, error) {
	cfg := Config{
		AppName:               "transvaalgalv-app",
		Environment:           getenv("APP_ENV", "development"),
		Port:                  getenv("PORT", "8080"),
		PublicBaseURL:         getenv("PUBLIC_BASE_URL", "https://transvaal.ayai.live"),
		DatabaseURL:           os.Getenv("TRANSVAAL_DATABASE_URL"),
		DocuWareBaseURL:       os.Getenv("DOCUWARE_BASE_URL"),
		DocuWareFileCabinetID: os.Getenv("DOCUWARE_FILE_CABINET_ID"),
	}

	if err := validateDatabaseURL(cfg.DatabaseURL); err != nil {
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
		return nil
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
