package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
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
	DocuWarePushUsername  string
	DocuWarePushPassword  string
	DocuWareUsername      string
	DocuWarePassword      string
	DocuWareSyncInterval  time.Duration
	DocuWareSyncMaxWorkers int

	// DocuWare integration-URL parameters for receiver-facing POD viewing.
	// Mirrors the parameters of the official DocuWare Integration URL builder:
	// AES-256-CBC encrypted blob containing login + cabinet + result-dialog + query.
	DocuWareIntegrationPassphraseB64 string
	DocuWareIntegrationUser          string
	DocuWareIntegrationPassword      string
	DocuWarePODCabinetID             string
	DocuWarePODResultDialogID        string

	// Filesystem location for captured photos (defect photos, future arrival/per-line).
	// Files live here until the DocuWare worker pushes them as Sections.
	PhotoStorageDir    string
	PhotoMaxBytes      int64

	// How many days a 'matched' receipt remains in the active list before
	// being auto-archived. Archived receipts are still queryable via
	// admin-only ?include_archived=1, just hidden from the default views.
	ArchiveAfter time.Duration
}

func Load() (Config, error) {
	accessTokenTTL, err := time.ParseDuration(getenv("ACCESS_TOKEN_TTL", "15m"))
	if err != nil {
		return Config{}, fmt.Errorf("invalid ACCESS_TOKEN_TTL: %w", err)
	}

	syncInterval, err := time.ParseDuration(getenv("DOCUWARE_SYNC_INTERVAL", "30s"))
	if err != nil {
		return Config{}, fmt.Errorf("invalid DOCUWARE_SYNC_INTERVAL: %w", err)
	}

	maxWorkers := 0
	if mw := strings.TrimSpace(os.Getenv("DOCUWARE_SYNC_MAX_WORKERS")); mw != "" {
		if parsed, err := strconv.Atoi(mw); err == nil {
			maxWorkers = parsed
		}
	}
	if maxWorkers <= 0 {
		maxWorkers = 3
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
		DocuWarePushUsername:  strings.TrimSpace(os.Getenv("DOCUWARE_PUSH_USERNAME")),
		DocuWarePushPassword:  strings.TrimSpace(os.Getenv("DOCUWARE_PUSH_PASSWORD")),
		DocuWareUsername:      os.Getenv("DOCUWARE_USERNAME"),
		DocuWarePassword:      os.Getenv("DOCUWARE_PASSWORD"),
		DocuWareSyncInterval:  syncInterval,
		DocuWareSyncMaxWorkers: maxWorkers,

		DocuWareIntegrationPassphraseB64: strings.TrimSpace(os.Getenv("DOCUWARE_INTEGRATION_PASSPHRASE_B64")),
		DocuWareIntegrationUser:          strings.TrimSpace(os.Getenv("DOCUWARE_INTEGRATION_USER")),
		DocuWareIntegrationPassword:      strings.TrimSpace(os.Getenv("DOCUWARE_INTEGRATION_PASSWORD")),
		DocuWarePODCabinetID:             strings.TrimSpace(os.Getenv("DOCUWARE_POD_CABINET_ID")),
		DocuWarePODResultDialogID:        strings.TrimSpace(os.Getenv("DOCUWARE_POD_RESULT_DIALOG_ID")),

		PhotoStorageDir: getenv("PHOTO_STORAGE_DIR", "/var/lib/transvaalgalv/photos"),
		PhotoMaxBytes:   parseBytes(getenv("PHOTO_MAX_BYTES", "10485760")), // 10 MiB default
		ArchiveAfter:    parseDays(getenv("ARCHIVE_AFTER_DAYS", "14")),
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

	if err := validateCredentialPair("DOCUWARE_PUSH_USERNAME", cfg.DocuWarePushUsername, "DOCUWARE_PUSH_PASSWORD", cfg.DocuWarePushPassword); err != nil {
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

func parseBytes(raw string) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value <= 0 {
		return 10 * 1024 * 1024
	}
	return value
}

// parseDays returns a duration in days from an integer-like string.
// Falls back to 14 days on parse error or non-positive values.
func parseDays(raw string) time.Duration {
	days, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || days <= 0 {
		days = 14
	}
	return time.Duration(days) * 24 * time.Hour
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

func validateCredentialPair(usernameName, username, passwordName, password string) error {
	username = strings.TrimSpace(username)
	password = strings.TrimSpace(password)

	if username == "" && password == "" {
		return nil
	}

	if username == "" {
		return fmt.Errorf("%s is required when %s is set", usernameName, passwordName)
	}

	if password == "" {
		return fmt.Errorf("%s is required when %s is set", passwordName, usernameName)
	}

	return nil
}
