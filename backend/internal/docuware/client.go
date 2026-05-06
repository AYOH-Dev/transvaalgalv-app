package docuware

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"
)

type Client struct {
	baseURL            string
	cabinetID          string
	username           string
	password           string
	tokenEndpoint      string
	httpClient         *http.Client
	token              string
	tokenExpiry        time.Time
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
	FieldName string `json:"FieldName"`
	Item      string `json:"Item,omitempty"`
	// ItemElementName is the XML-choice-type discriminator. DocuWare's
	// deserializer rejects the request when this is present-but-empty
	// (BadRequest: "Error converting value \"\" to type 'ItemChoiceType'").
	// omitempty drops it from the payload when the field is null, which
	// is the only shape the server accepts for null values.
	ItemElementName   string  `json:"ItemElementName,omitempty"`
	ReadOnly          bool    `json:"ReadOnly"`
	SystemField       bool    `json:"SystemField"`
	PointAndShootInfo *string `json:"PointAndShootInfo"`
	IsAutoNumber      bool    `json:"IsAutoNumber"`
	IsNull            bool    `json:"IsNull"`
}

type FieldsUpdateRequest struct {
	Field                []FieldUpdate `json:"Field"`
	DialogId             string        `json:"DialogId"`
	NormalizeCoordinates bool          `json:"NormalizeCoordinates"`
}

func NewClient(baseURL, cabinetID, username, password string) *Client {
	// For this project, the OAuth token endpoint is fixed (tenant-specific identity server)
	// Future enhancement: could be made configurable via environment variable
	return &Client{
		baseURL:            strings.TrimSuffix(baseURL, "/"),
		cabinetID:          cabinetID,
		username:           username,
		password:           password,
		tokenEndpoint:      "https://login-emea.docuware.cloud/b4a3e702-f181-4371-a2b0-a94f26b8d7b7/connect/token",
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

// UpdateLineFields updates fields for a single document (line) in the
// Receiving Data cabinet. Convenience wrapper around UpdateDocumentFields
// preserved for the existing call sites.
func (c *Client) UpdateLineFields(ctx context.Context, docuwareRecordLineID string, fields []FieldUpdate) error {
	return c.UpdateDocumentFields(ctx, c.cabinetID, docuwareRecordLineID, fields, "i_8dd45d75-5ba2-4ca1-86a8-6b30a37082d4")
}

// UpdateDocumentFields updates the index fields on a specific document
// in the named file cabinet. dialogID may be empty; DocuWare accepts
// omitting it for plain field updates.
func (c *Client) UpdateDocumentFields(ctx context.Context, fileCabinetID, docID string, fields []FieldUpdate, dialogID string) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	if strings.TrimSpace(fileCabinetID) == "" {
		return fmt.Errorf("file cabinet id is required")
	}
	if strings.TrimSpace(docID) == "" {
		return fmt.Errorf("doc id is required")
	}

	payload := FieldsUpdateRequest{
		Field:                fields,
		DialogId:             dialogID,
		NormalizeCoordinates: true,
	}
	jsonBody, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal field update: %w", err)
	}

	url := fmt.Sprintf(
		"%s/DocuWare/Platform/FileCabinets/%s/Documents/%s/Fields",
		c.baseURL,
		fileCabinetID,
		docID,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(jsonBody))
	if err != nil {
		return fmt.Errorf("create update request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

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

// IndexField is a single name/value pair for a DocuWare document's
// index. We always send strings; DocuWare casts to the field's declared
// type on the server side.
type IndexField struct {
	FieldName string `json:"FieldName"`
	Item      string `json:"Item"`
}

type createDocumentBody struct {
	Fields []IndexField `json:"Fields"`
}

// CreateDocumentResponse carries just the doc id from DocuWare's response;
// the rest of the JSON envelope is ignored.
type CreateDocumentResponse struct {
	ID int `json:"Id"`
}

// CreateDocument uploads a new document into the named file cabinet with
// the supplied index fields and primary file content. Returns the new
// document's id as a string (DocuWare returns it as a number).
//
// Endpoint:
//
//	POST {base}/DocuWare/Platform/FileCabinets/{cabinetId}/Documents
//
// Wire format: multipart/form-data with two parts:
//   - "document"  (Content-Type: application/json) — the index fields
//   - "file"      (Content-Type: <contentType>)    — the primary file bytes
func (c *Client) CreateDocument(
	ctx context.Context,
	fileCabinetID string,
	fields []IndexField,
	filename string,
	contentType string,
	body io.Reader,
) (string, error) {
	if err := c.ensureToken(ctx); err != nil {
		return "", err
	}
	if strings.TrimSpace(fileCabinetID) == "" {
		return "", fmt.Errorf("file cabinet id is required")
	}

	indexJSON, err := json.Marshal(createDocumentBody{Fields: fields})
	if err != nil {
		return "", fmt.Errorf("marshal index fields: %w", err)
	}

	var bodyBuf bytes.Buffer
	mw := multipart.NewWriter(&bodyBuf)

	// Index-fields part
	indexHdr := textproto.MIMEHeader{}
	indexHdr.Set("Content-Disposition", `form-data; name="document"`)
	indexHdr.Set("Content-Type", "application/json")
	indexPart, err := mw.CreatePart(indexHdr)
	if err != nil {
		return "", fmt.Errorf("multipart create index part: %w", err)
	}
	if _, err := indexPart.Write(indexJSON); err != nil {
		return "", fmt.Errorf("multipart write index: %w", err)
	}

	// File part
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	fileHdr := textproto.MIMEHeader{}
	fileHdr.Set("Content-Disposition",
		fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	fileHdr.Set("Content-Type", contentType)
	filePart, err := mw.CreatePart(fileHdr)
	if err != nil {
		return "", fmt.Errorf("multipart create file part: %w", err)
	}
	if _, err := io.Copy(filePart, body); err != nil {
		return "", fmt.Errorf("multipart copy file: %w", err)
	}
	if err := mw.Close(); err != nil {
		return "", fmt.Errorf("multipart close: %w", err)
	}

	url := fmt.Sprintf(
		"%s/DocuWare/Platform/FileCabinets/%s/Documents",
		c.baseURL,
		fileCabinetID,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &bodyBuf)
	if err != nil {
		return "", fmt.Errorf("create document request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("create document failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("create document failed with status %d: %s",
			resp.StatusCode, string(respBody))
	}

	var parsed CreateDocumentResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("parse create document response: %w", err)
	}
	if parsed.ID == 0 {
		return "", fmt.Errorf("create document returned no id")
	}
	return fmt.Sprintf("%d", parsed.ID), nil
}

// AppendSection appends a new Section (clipped attachment) to an existing
// document in the named file cabinet.
//
// The DocuWare REST endpoint:
//
//	POST {base}/DocuWare/Platform/FileCabinets/{cabinetId}/Sections?DocId={docId}
//
// The wire format is multipart/form-data with a single file part. DocuWare
// returns 200 OK with the section metadata; we don't currently consume the
// returned id (the photo's primary identity stays with our row).
func (c *Client) AppendSection(
	ctx context.Context,
	fileCabinetID string,
	docID string,
	filename string,
	contentType string,
	body io.Reader,
) error {
	if err := c.ensureToken(ctx); err != nil {
		return err
	}
	if strings.TrimSpace(fileCabinetID) == "" {
		return fmt.Errorf("file cabinet id is required")
	}
	if strings.TrimSpace(docID) == "" {
		return fmt.Errorf("doc id is required")
	}

	var bodyBuf bytes.Buffer
	mw := multipart.NewWriter(&bodyBuf)

	hdr := textproto.MIMEHeader{}
	hdr.Set("Content-Disposition",
		fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	hdr.Set("Content-Type", contentType)

	part, err := mw.CreatePart(hdr)
	if err != nil {
		return fmt.Errorf("multipart create part: %w", err)
	}
	if _, err := io.Copy(part, body); err != nil {
		return fmt.Errorf("multipart copy body: %w", err)
	}
	if err := mw.Close(); err != nil {
		return fmt.Errorf("multipart close: %w", err)
	}

	url := fmt.Sprintf(
		"%s/DocuWare/Platform/FileCabinets/%s/Sections?DocId=%s",
		c.baseURL,
		fileCabinetID,
		docID,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &bodyBuf)
	if err != nil {
		return fmt.Errorf("create section request: %w", err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("section upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("section upload failed with status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
