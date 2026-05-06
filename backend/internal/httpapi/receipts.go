package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/docuware"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/receiving"
	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/users"
)

func (a *App) handleCreateGRN(w http.ResponseWriter, r *http.Request) {
	var input receiving.CreateGRNInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// received_by is the accountability anchor for the receipt and is always
	// taken from the authenticated session — never from the request body.
	// stored_by is a separate, editable field (who physically put the goods
	// into the bay) and may differ from the receiver.
	subject, ok := currentSubject(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	input.ReceivedByUserID = subject.UserID
	if user, err := a.users.CurrentUser(r.Context(), subject.UserID); err == nil {
		input.ReceivedByName = user.DisplayName
	} else {
		// Fall back to the email — better than blank, and the UUID still
		// anchors accountability via the FK.
		input.ReceivedByName = subject.Email
	}
	if strings.TrimSpace(input.StoredBy) == "" {
		input.StoredBy = subject.Email
	}

	receipt, err := a.receiving.CreateGRN(r.Context(), input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, receipt)
}

func (a *App) handleListReceipts(w http.ResponseWriter, r *http.Request) {
	// include_archived is admin-only. Non-admins (or missing flag) get the
	// default active-only list. We silently ignore the flag for non-admins
	// rather than 403'ing — the result is the same as not asking.
	includeArchived := false
	if r.URL.Query().Get("include_archived") == "1" {
		if subject, ok := currentSubject(r.Context()); ok && users.Role(subject.Role) == users.RoleAdmin {
			includeArchived = true
		}
	}

	result, err := a.receiving.ListReceipts(r.Context(), includeArchived)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"count":    len(result),
		"receipts": result,
	})
}

func (a *App) handleGetReceipt(w http.ResponseWriter, r *http.Request) {
	receipt, err := a.receiving.GetReceipt(r.Context(), r.PathValue("id"))
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, receipt)
}

// handleGetReceiptPODLink returns a one-shot DocuWare WebClient Integration URL
// that opens the POD document for this receipt in the DocuWare viewer. The
// URL embeds an AES-encrypted login + query, so we generate it server-side and
// hand the receiver only the final URL (never the credentials or passphrase).
func (a *App) handleGetReceiptPODLink(w http.ResponseWriter, r *http.Request) {
	receipt, err := a.receiving.GetReceipt(r.Context(), r.PathValue("id"))
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	docID := strings.TrimSpace(receipt.SourceDocuWareDocument)
	if docID == "" {
		writeError(w, http.StatusNotFound, "no POD reference on this receipt")
		return
	}

	cfg := docuware.IntegrationConfig{
		ServerURL:        a.cfg.DocuWareBaseURL,
		PassphraseBase64: a.cfg.DocuWareIntegrationPassphraseB64,
		Username:         a.cfg.DocuWareIntegrationUser,
		Password:         a.cfg.DocuWareIntegrationPassword,
		CabinetID:        a.cfg.DocuWarePODCabinetID,
		ResultDialogID:   a.cfg.DocuWarePODResultDialogID,
	}
	if !cfg.Configured() {
		writeError(w, http.StatusServiceUnavailable, "POD viewer is not configured")
		return
	}

	// DocuWare condition syntax — match by the document's own DWDOCID.
	query := fmt.Sprintf(`[DWDOCID] = "%s"`, escapeDocuWareLiteral(docID))
	url, err := docuware.BuildIntegrationURL(cfg, docuware.ModeViewer, query)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build POD link")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// escapeDocuWareLiteral hardens against an attacker-controlled DNDocID landing
// in the query string. DocuWare condition literals are quoted with " — escape
// any embedded quotes and strip newlines.
func escapeDocuWareLiteral(s string) string {
	s = strings.ReplaceAll(s, `"`, `""`)
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

func (a *App) handleUpdateReceipt(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var input receiving.UpdateReceiptInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := a.receiving.UpdateReceipt(r.Context(), id, input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	// Embed the Receipt and add resynced_lines as a sibling key without touching
	// the Receipt type — Go marshals the embedded struct's fields inline.
	type updateReceiptResponse struct {
		receiving.Receipt
		ResyncedLines int `json:"resynced_lines"`
	}
	writeJSON(w, http.StatusOK, updateReceiptResponse{
		Receipt:       result.Receipt,
		ResyncedLines: result.ResyncedLines,
	})
}

func (a *App) handleUpdateReceiptLine(w http.ResponseWriter, r *http.Request) {
	receiptID := r.PathValue("id")
	lineID := r.PathValue("lineId")

	var input receiving.UpdateReceiptLineInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Stamp the confirmer from the authenticated session. The repository
	// only writes received_by_* on the transition to "received", so it's
	// safe (and correct) to attach this on every PATCH — even non-confirm
	// edits — without overwriting an existing confirmer.
	subject, ok := currentSubject(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	input.ReceivedByUserID = subject.UserID
	if user, err := a.users.CurrentUser(r.Context(), subject.UserID); err == nil {
		input.ReceivedByName = user.DisplayName
	} else {
		input.ReceivedByName = subject.Email
	}

	line, err := a.receiving.UpdateReceiptLine(r.Context(), receiptID, lineID, input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, line)
}

func (a *App) handleBulkUpdateReceiptLines(w http.ResponseWriter, r *http.Request) {
	receiptID := r.PathValue("id")

	var input receiving.BulkUpdateReceiptLinesInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Stamp the confirmer once for the whole batch — same pattern as the
	// per-line handler (the repository only writes received_by_* on the
	// transition to "received").
	subject, ok := currentSubject(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	input.Patch.ReceivedByUserID = subject.UserID
	if user, err := a.users.CurrentUser(r.Context(), subject.UserID); err == nil {
		input.Patch.ReceivedByName = user.DisplayName
	} else {
		input.Patch.ReceivedByName = subject.Email
	}

	result, err := a.receiving.BulkUpdateReceiptLines(r.Context(), receiptID, input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (a *App) handleSyncReceiptLineDocuWare(w http.ResponseWriter, r *http.Request) {
	receiptID := r.PathValue("id")
	var payload struct {
		LineID string `json:"line_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body (line_id required)")
		return
	}

	if strings.TrimSpace(payload.LineID) == "" {
		writeError(w, http.StatusBadRequest, "line_id is required")
		return
	}

	// Verify the line belongs to this receipt
	receipt, err := a.receiving.GetReceipt(r.Context(), receiptID)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	lineFound := false
	for _, line := range receipt.Lines {
		if line.ID == payload.LineID {
			lineFound = true
			break
		}
	}

	if !lineFound {
		writeError(w, http.StatusNotFound, "line not found in receipt")
		return
	}

	// Attempt to enqueue the sync
	if err := a.receiving.EnqueueLineSync(r.Context(), receiptID, payload.LineID); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to enqueue sync: %v", err))
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":  "queued",
		"message": "Line sync queued for DocuWare",
	})
}

func (a *App) handleImportDocuWareRows(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	log.Printf("[docuware-import] received at=%s remote=%s content-type=%s body=%s",
		time.Now().UTC().Format(time.RFC3339),
		r.RemoteAddr,
		r.Header.Get("Content-Type"),
		body,
	)

	request, err := decodeDocuWareImportInput(r, a.cfg.DocuWareFileCabinetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := a.receiving.ImportDocuWareRows(r.Context(), request)
	if err != nil {
		log.Printf("[docuware-import] error: %v", err)
		mapReceivingError(w, err)
		return
	}

	log.Printf("[docuware-import] success: %d receipts, %d rows", result.ImportedReceiptCount, result.ImportedRowCount)
	writeJSON(w, http.StatusCreated, result)
}

func decodeDocuWareImportInput(r *http.Request, defaultCabinetID string) (receiving.DocuWareImportInput, error) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return receiving.DocuWareImportInput{}, fmt.Errorf("read request body: %w", err)
	}

	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return receiving.DocuWareImportInput{}, fmt.Errorf("request body is required")
	}

	switch body[0] {
	case '{':
		return decodeDocuWareImportObject(body, defaultCabinetID)
	case '[':
		var payloads []map[string]any
		if err := json.Unmarshal(body, &payloads); err != nil {
			return receiving.DocuWareImportInput{}, fmt.Errorf("decode payload array: %w", err)
		}

		request := receiving.DocuWareImportInput{Rows: make([]receiving.DocuWareImportRow, 0, len(payloads))}
		for _, payload := range payloads {
			request.Rows = append(request.Rows, receiving.DocuWareImportRow{Payload: payload})
		}

		normalizeDocuWareImportInput(&request, defaultCabinetID)
		return request, nil
	default:
		return receiving.DocuWareImportInput{}, fmt.Errorf("unsupported json payload")
	}
}

func decodeDocuWareImportObject(body []byte, defaultCabinetID string) (receiving.DocuWareImportInput, error) {
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(body, &topLevel); err != nil {
		return receiving.DocuWareImportInput{}, fmt.Errorf("decode import object: %w", err)
	}

	if _, ok := topLevel["rows"]; ok {
		var request receiving.DocuWareImportInput
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			return receiving.DocuWareImportInput{}, fmt.Errorf("decode wrapped import: %w", err)
		}

		normalizeDocuWareImportInput(&request, defaultCabinetID)
		return request, nil
	}

	if payloadRaw, ok := topLevel["payload"]; ok {
		var payload map[string]any
		if err := json.Unmarshal(payloadRaw, &payload); err != nil {
			return receiving.DocuWareImportInput{}, fmt.Errorf("decode payload wrapper: %w", err)
		}

		request := receiving.DocuWareImportInput{
			SourceCabinetID:  topLevelString(topLevel, "source_cabinet_id"),
			SourceDocumentID: topLevelString(topLevel, "source_document_id"),
			Rows: []receiving.DocuWareImportRow{{
				RecordID: topLevelString(topLevel, "record_id"),
				Payload:  payload,
			}},
		}

		normalizeDocuWareImportInput(&request, defaultCabinetID)
		return request, nil
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return receiving.DocuWareImportInput{}, fmt.Errorf("decode flat payload: %w", err)
	}

	request := receiving.DocuWareImportInput{
		Rows: []receiving.DocuWareImportRow{{Payload: payload}},
	}

	normalizeDocuWareImportInput(&request, defaultCabinetID)
	return request, nil
}

func normalizeDocuWareImportInput(request *receiving.DocuWareImportInput, defaultCabinetID string) {
	if request == nil {
		return
	}

	if strings.TrimSpace(request.SourceCabinetID) == "" {
		request.SourceCabinetID = firstNonEmpty(
			firstRowPayloadString(request.Rows, "DWSYS_FC_GUID"),
			strings.TrimSpace(defaultCabinetID),
		)
	}

	if strings.TrimSpace(request.SourceDocumentID) == "" {
		request.SourceDocumentID = firstNonEmpty(
			firstRowPayloadString(request.Rows, "DNDOCID"),
			firstRowPayloadString(request.Rows, "DNDOCIDI"),
			firstRowPayloadString(request.Rows, "DWDOCID"),
		)
	}

	for index := range request.Rows {
		if request.Rows[index].Payload == nil {
			request.Rows[index].Payload = map[string]any{}
		}

		if strings.TrimSpace(request.Rows[index].RecordID) == "" {
			request.Rows[index].RecordID = firstNonEmpty(
				payloadStringValue(request.Rows[index].Payload, "DWDOCID"),
				payloadStringValue(request.Rows[index].Payload, "PRIMARY_KEY"),
				payloadStringValue(request.Rows[index].Payload, "UNIQUE_NUMBER"),
			)
		}
	}
}

func topLevelString(payload map[string]json.RawMessage, key string) string {
	raw, ok := payload[key]
	if !ok {
		return ""
	}

	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return ""
	}

	return strings.TrimSpace(stringValue(value))
}

func firstRowPayloadString(rows []receiving.DocuWareImportRow, key string) string {
	if len(rows) == 0 {
		return ""
	}

	return payloadStringValue(rows[0].Payload, key)
}

func payloadStringValue(payload map[string]any, key string) string {
	if len(payload) == 0 {
		return ""
	}

	return strings.TrimSpace(stringValue(payload[key]))
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		return fmt.Sprint(value)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}

	return ""
}
