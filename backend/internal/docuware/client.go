package docuware

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL         string
	cabinetID       string
	username        string
	password        string
	tokenEndpoint   string
	httpClient      *http.Client
	token           string
	tokenExpiry     time.Time
	discoveredEndpoint bool
}

type TokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

type OpenIDConfig struct {
	TokenEndpoint string `json:"token_endpoint"`
}

type IdentityServiceInfo struct {
	IdentityServiceUrl string `json:"IdentityServiceUrl"`
}

type FieldUpdate struct {
	FieldName               string `json:"FieldName"`
	Item                   string `json:"Item"`
	ItemElementName        string `json:"ItemElementName"`
	ReadOnly               bool   `json:"ReadOnly"`
	SystemField            bool   `json:"SystemField"`
	PointAndShootInfo      *string `json:"PointAndShootInfo"`
	IsAutoNumber           bool   `json:"IsAutoNumber"`
	IsNull                 bool   `json:"IsNull"`
}

type FieldsUpdateRequest struct {
	Field                  []FieldUpdate `json:"Field"`
	DialogId               string        `json:"DialogId"`
	NormalizeCoordinates   bool          `json:"NormalizeCoordinates"`
}

func NewClient(baseURL, cabinetID, username, password string) *Client {
	// For this project, the OAuth token endpoint is fixed (tenant-specific identity server)
	// Future enhancement: could be made configurable via environment variable
	return &Client{
		baseURL:        strings.TrimSuffix(baseURL, "/"),
		cabinetID:      cabinetID,
		username:       username,
		password:       password,
		tokenEndpoint:  "https://login-emea.docuware.cloud/b4a3e702-f181-4371-a2b0-a94f26b8d7b7/connect/token",
		discoveredEndpoint: true,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) ensureToken(ctx context.Context) error {
	if c.token != "" && time.Now().Before(c.tokenExpiry) {
		return nil
	}

	body := strings.NewReader(
		"grant_type=password&" +
		"client_id=docuware.platform.net.client&" +
		"scope=docuware.platform&" +
		fmt.Sprintf("username=%s&password=%s", c.username, c.password),
	)

	req, err := http.NewRequestWithContext(ctx, "POST", c.tokenEndpoint, body)
	if err != nil {
		return fmt.Errorf("create token request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("token request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return fmt.Errorf("parse token response: %w", err)
	}

	c.token = tokenResp.AccessToken
	c.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second).Add(-1 * time.Minute)

	return nil
}

// UpdateLineFields updates fields for a single document (line) in the cabinet.
// docuwareRecordLineID should be the document ID (e.g., DWDOCID).
func (c *Client) UpdateLineFields(ctx context.Context, docuwareRecordLineID string, fields []FieldUpdate) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}

	if docuwareRecordLineID == "" {
		return fmt.Errorf("docuware_record_line_id is required")
	}

	payload := FieldsUpdateRequest{
		Field:                fields,
		DialogId:             "i_8dd45d75-5ba2-4ca1-86a8-6b30a37082d4",
		NormalizeCoordinates: true,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal field update: %w", err)
	}

	url := fmt.Sprintf(
		"%s/DocuWare/Platform/FileCabinets/%s/Documents/%s/Fields",
		c.baseURL,
		c.cabinetID,
		docuwareRecordLineID,
	)

	req, err := http.NewRequestWithContext(ctx, "PUT", url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create update request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.token))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("update request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("update failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// BasicAuthHeader returns a Basic Auth header value for DocuWare push endpoint.
func BasicAuthHeader(username, password string) string {
	credentials := base64.StdEncoding.EncodeToString([]byte(username + ":" + password))
	return "Basic " + credentials
}
