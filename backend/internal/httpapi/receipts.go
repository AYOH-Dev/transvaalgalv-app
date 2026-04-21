package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

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

func (a *App) handleImportDocuWareRows(w http.ResponseWriter, r *http.Request) {
	request, err := decodeDocuWareImportInput(r, a.cfg.DocuWareFileCabinetID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := a.receiving.ImportDocuWareRows(r.Context(), request)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

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
