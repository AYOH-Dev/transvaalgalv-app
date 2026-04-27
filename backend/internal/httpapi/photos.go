package httpapi

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/AYOH-Dev/transvaalgalv-app/backend/internal/receiving"
)

// handleUploadDefectPhoto accepts a multipart/form-data upload with a single
// "photo" file and stores it against the line. The DocuWare worker pushes
// it as a Section asynchronously.
func (a *App) handleUploadDefectPhoto(w http.ResponseWriter, r *http.Request) {
	if a.photos == nil {
		writeError(w, http.StatusServiceUnavailable, "photo capture is not configured")
		return
	}

	receiptID := r.PathValue("id")
	lineID := r.PathValue("lineId")

	maxBytes := a.photos.MaxBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1024) // +1KiB for multipart envelope
	if err := r.ParseMultipartForm(maxBytes + 1024); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("photo too large (max %d bytes)", maxBytes))
		return
	}

	file, header, err := r.FormFile("photo")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing 'photo' file part")
		return
	}
	defer file.Close()

	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		writeError(w, http.StatusBadRequest, "photo content type is required")
		return
	}

	subject, _ := currentSubject(r.Context())

	doc, err := a.photos.UploadDefectPhoto(r.Context(), receiving.PhotoUploadInput{
		ReceiptID:    receiptID,
		LineID:       lineID,
		Category:     receiving.PhotoCategoryDefect,
		Filename:     header.Filename,
		ContentType:  contentType,
		Body:         file,
		MaxBytes:     maxBytes,
		UploadedByID: subject.UserID,
	})
	if err != nil {
		mapPhotoError(w, err)
		return
	}

	// Trigger an immediate worker tick so the photo doesn't sit waiting for
	// the next poll interval. Best-effort — failure is non-fatal.
	if a.photoEnqueuer != nil {
		_ = a.photoEnqueuer.NotifyPendingPhoto(r.Context(), doc.ID)
	}

	writeJSON(w, http.StatusCreated, doc)
}

// handleGetDefectPhoto streams the photo bytes back. Auth is already
// enforced by requireAuth — any logged-in user can fetch any photo whose
// id they know.
func (a *App) handleGetDefectPhoto(w http.ResponseWriter, r *http.Request) {
	if a.photos == nil {
		writeError(w, http.StatusServiceUnavailable, "photo capture is not configured")
		return
	}
	photoID := r.PathValue("photoId")

	file, doc, err := a.photos.OpenPhoto(r.Context(), photoID)
	if err != nil {
		mapPhotoError(w, err)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", doc.ContentType)
	if doc.FileSize > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(doc.FileSize, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", doc.Filename))

	if _, err := io.Copy(w, file); err != nil {
		// Connection likely dropped; nothing actionable here.
		return
	}
}

// handleGetGRN streams the GRN PDF for a receipt back to the caller.
// Returns 404 until the receipt's status has been moved to 'matched' and
// the PDF has been generated (which is synchronous in the status PATCH
// path, so the file should be available on the next request).
func (a *App) handleGetGRN(w http.ResponseWriter, r *http.Request) {
	if a.photos == nil {
		writeError(w, http.StatusServiceUnavailable, "photo capture is not configured")
		return
	}
	receiptID := r.PathValue("id")

	file, doc, err := a.photos.OpenGRN(r.Context(), receiptID)
	if err != nil {
		mapPhotoError(w, err)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", doc.ContentType)
	if doc.FileSize > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(doc.FileSize, 10))
	}
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", doc.Filename))

	if _, err := io.Copy(w, file); err != nil {
		return
	}
}

// handleDeleteDefectPhoto removes a not-yet-synced photo. Synced photos
// remain (they live in DocuWare).
func (a *App) handleDeleteDefectPhoto(w http.ResponseWriter, r *http.Request) {
	if a.photos == nil {
		writeError(w, http.StatusServiceUnavailable, "photo capture is not configured")
		return
	}
	photoID := r.PathValue("photoId")

	if err := a.photos.DeletePhoto(r.Context(), photoID); err != nil {
		mapPhotoError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func mapPhotoError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, receiving.ErrNotFound):
		writeError(w, http.StatusNotFound, "photo not found")
	case errors.Is(err, receiving.ErrConflict):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, receiving.ErrInvalidInput):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, receiving.ErrUnavailable):
		writeError(w, http.StatusServiceUnavailable, "photo service unavailable")
	default:
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}
