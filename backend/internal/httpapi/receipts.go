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

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/receiving"
)

func (a *App) handleListReceipts(w http.ResponseWriter, r *http.Request) {
	result, err := a.receiving.ListReceipts(r.Context())
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

func (a *App) handleUpdateReceipt(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var input receiving.UpdateReceiptInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	receipt, err := a.receiving.UpdateReceipt(r.Context(), id, input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, receipt)
}

func (a *App) handleUpdateReceiptLine(w http.ResponseWriter, r *http.Request) {
	receiptID := r.PathValue("id")
	lineID := r.PathValue("lineId")

	var input receiving.UpdateReceiptLineInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	line, err := a.receiving.UpdateReceiptLine(r.Context(), receiptID, lineID, input)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, line)
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
		"status": "queued",
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
