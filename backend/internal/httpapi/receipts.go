package httpapi

import (
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
	var request receiving.DocuWareImportInput
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(request.SourceCabinetID) == "" {
		request.SourceCabinetID = strings.TrimSpace(a.cfg.DocuWareFileCabinetID)
	}

	result, err := a.receiving.ImportDocuWareRows(r.Context(), request)
	if err != nil {
		mapReceivingError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, result)
}