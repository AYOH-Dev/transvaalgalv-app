package receiving

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// PhotoCategory enumerates the supported capture categories. Phase 1 is
// defect photos only; arrival/as-received land in later iterations.
type PhotoCategory string

const (
	PhotoCategoryDefect PhotoCategory = "defect_photo"
)

// AllowedPhotoMIME is the whitelist of accepted upload content types.
// HEIC is included for iPad/Safari capture.
var AllowedPhotoMIME = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/heic": ".heic",
	"image/heif": ".heif",
	"image/webp": ".webp",
}

// PhotoUploadInput is the service-level payload for a single photo upload.
type PhotoUploadInput struct {
	ReceiptID    string
	LineID       string
	Category     PhotoCategory
	Filename     string
	ContentType  string
	Body         io.Reader
	MaxBytes     int64
	UploadedByID string
}

type PhotoRepository interface {
	GetReceiptLine(ctx context.Context, receiptID, lineID string) (ReceiptLine, error)
	GetReceipt(ctx context.Context, id string) (Receipt, error)
	InsertPhotoDocument(ctx context.Context, input InsertPhotoDocumentInput) (ReceiptDocument, error)
	GetPhotoDocument(ctx context.Context, photoID string) (ReceiptDocument, string, error)
	DeletePhotoDocument(ctx context.Context, photoID string) (string, error)
}

// InsertPhotoDocumentInput captures everything the repository needs to
// persist a photo row. Caller owns file placement; repo writes the metadata.
type InsertPhotoDocumentInput struct {
	ReceiptID     string
	ReceiptLineID string
	Category      PhotoCategory
	Filename      string
	ContentType   string
	StorageKey    string
	FileSize      int64
	UploadedByID  string
}

type PhotoService struct {
	repo       PhotoRepository
	storageDir string
	maxBytes   int64
}

func NewPhotoService(repo PhotoRepository, storageDir string, maxBytes int64) *PhotoService {
	return &PhotoService{repo: repo, storageDir: storageDir, maxBytes: maxBytes}
}

// MaxBytes is exposed so the HTTP layer can enforce the same cap before
// reading the body.
func (s *PhotoService) MaxBytes() int64 { return s.maxBytes }

// UploadDefectPhoto stores the photo on disk, persists the metadata row,
// and returns the resulting document. The caller (HTTP layer) is
// responsible for limiting the request body size.
func (s *PhotoService) UploadDefectPhoto(ctx context.Context, input PhotoUploadInput) (ReceiptDocument, error) {
	if s.repo == nil {
		return ReceiptDocument{}, ErrUnavailable
	}
	if strings.TrimSpace(input.ReceiptID) == "" || strings.TrimSpace(input.LineID) == "" {
		return ReceiptDocument{}, fmt.Errorf("%w: receipt_id and line_id are required", ErrInvalidInput)
	}

	ext, ok := AllowedPhotoMIME[strings.ToLower(strings.TrimSpace(input.ContentType))]
	if !ok {
		return ReceiptDocument{}, fmt.Errorf("%w: unsupported content type %q", ErrInvalidInput, input.ContentType)
	}

	// Verify the line belongs to the receipt before writing anything to disk.
	line, err := s.repo.GetReceiptLine(ctx, input.ReceiptID, input.LineID)
	if err != nil {
		return ReceiptDocument{}, err
	}
	if line.ID == "" {
		return ReceiptDocument{}, ErrNotFound
	}

	maxBytes := input.MaxBytes
	if maxBytes <= 0 {
		maxBytes = s.maxBytes
	}

	storageKey, absPath, err := s.allocateStoragePath(input.ReceiptID, input.LineID, input.Category, ext)
	if err != nil {
		return ReceiptDocument{}, fmt.Errorf("allocate storage path: %w", err)
	}

	written, err := writeLimitedFile(absPath, input.Body, maxBytes)
	if err != nil {
		_ = os.Remove(absPath)
		return ReceiptDocument{}, err
	}

	filename := sanitizeFilename(input.Filename, ext)

	doc, err := s.repo.InsertPhotoDocument(ctx, InsertPhotoDocumentInput{
		ReceiptID:     input.ReceiptID,
		ReceiptLineID: input.LineID,
		Category:      input.Category,
		Filename:      filename,
		ContentType:   input.ContentType,
		StorageKey:    storageKey,
		FileSize:      written,
		UploadedByID:  input.UploadedByID,
	})
	if err != nil {
		_ = os.Remove(absPath)
		return ReceiptDocument{}, err
	}
	return doc, nil
}

// OpenPhoto returns the open file handle plus the document metadata, so
// the HTTP layer can stream it back to the client. Caller closes the file.
func (s *PhotoService) OpenPhoto(ctx context.Context, photoID string) (*os.File, ReceiptDocument, error) {
	if s.repo == nil {
		return nil, ReceiptDocument{}, ErrUnavailable
	}
	doc, storageKey, err := s.repo.GetPhotoDocument(ctx, photoID)
	if err != nil {
		return nil, ReceiptDocument{}, err
	}

	absPath, err := s.resolveStoragePath(storageKey)
	if err != nil {
		return nil, ReceiptDocument{}, err
	}
	f, err := os.Open(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ReceiptDocument{}, ErrNotFound
		}
		return nil, ReceiptDocument{}, fmt.Errorf("open photo: %w", err)
	}
	return f, doc, nil
}

// OpenGRN returns the GRN PDF file handle + metadata for streaming. Returns
// ErrNotFound if the receipt has no GRN yet (i.e. status hasn't moved to
// 'matched' or generation is still in flight). Caller closes the file.
func (s *PhotoService) OpenGRN(ctx context.Context, receiptID string) (*os.File, ReceiptDocument, error) {
	if s.repo == nil {
		return nil, ReceiptDocument{}, ErrUnavailable
	}
	receipt, err := s.repo.GetReceipt(ctx, receiptID)
	if err != nil {
		return nil, ReceiptDocument{}, err
	}
	if strings.TrimSpace(receipt.GRNDocumentID) == "" {
		return nil, ReceiptDocument{}, ErrNotFound
	}
	doc, storageKey, err := s.repo.GetPhotoDocument(ctx, receipt.GRNDocumentID)
	if err != nil {
		return nil, ReceiptDocument{}, err
	}
	absPath, err := s.resolveStoragePath(storageKey)
	if err != nil {
		return nil, ReceiptDocument{}, err
	}
	f, err := os.Open(absPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ReceiptDocument{}, ErrNotFound
		}
		return nil, ReceiptDocument{}, fmt.Errorf("open grn: %w", err)
	}
	return f, doc, nil
}

// DeletePhoto removes a pending (not-yet-synced) photo's row + file. Synced
// photos are kept — they live in DocuWare and removing the local file would
// leave orphaned references.
func (s *PhotoService) DeletePhoto(ctx context.Context, photoID string) error {
	if s.repo == nil {
		return ErrUnavailable
	}
	storageKey, err := s.repo.DeletePhotoDocument(ctx, photoID)
	if err != nil {
		return err
	}
	absPath, err := s.resolveStoragePath(storageKey)
	if err != nil {
		return nil // row gone, treat best-effort
	}
	_ = os.Remove(absPath)
	return nil
}

// allocateStoragePath builds {receiptID}/{lineID}/{category}_{rand}{ext}.
// The relative path is stored in the DB; the absolute path is used to write.
func (s *PhotoService) allocateStoragePath(receiptID, lineID string, category PhotoCategory, ext string) (string, string, error) {
	if strings.TrimSpace(s.storageDir) == "" {
		return "", "", fmt.Errorf("photo storage dir not configured")
	}
	suffix := make([]byte, 8)
	if _, err := rand.Read(suffix); err != nil {
		return "", "", fmt.Errorf("generate suffix: %w", err)
	}
	relDir := filepath.Join(receiptID, lineID)
	absDir := filepath.Join(s.storageDir, relDir)
	if err := os.MkdirAll(absDir, 0o750); err != nil {
		return "", "", fmt.Errorf("mkdir %s: %w", absDir, err)
	}
	name := fmt.Sprintf("%s_%d_%s%s", string(category), time.Now().UnixNano(), hex.EncodeToString(suffix), ext)
	return filepath.Join(relDir, name), filepath.Join(absDir, name), nil
}

// resolveStoragePath joins the relative storage_key onto the configured
// base dir and rejects any traversal attempts.
func (s *PhotoService) resolveStoragePath(storageKey string) (string, error) {
	clean := filepath.Clean(storageKey)
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: invalid storage key", ErrInvalidInput)
	}
	abs := filepath.Join(s.storageDir, clean)
	// Final containment check.
	rel, err := filepath.Rel(s.storageDir, abs)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("%w: storage key escapes base dir", ErrInvalidInput)
	}
	return abs, nil
}

// writeLimitedFile streams body into the file, capping at maxBytes.
// Returns the number of bytes written.
func writeLimitedFile(absPath string, body io.Reader, maxBytes int64) (int64, error) {
	f, err := os.OpenFile(absPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return 0, fmt.Errorf("create photo file: %w", err)
	}
	defer f.Close()

	limited := io.LimitReader(body, maxBytes+1)
	written, err := io.Copy(f, limited)
	if err != nil {
		return 0, fmt.Errorf("write photo: %w", err)
	}
	if written > maxBytes {
		return 0, fmt.Errorf("%w: photo exceeds max size of %d bytes", ErrInvalidInput, maxBytes)
	}
	if err := f.Sync(); err != nil {
		return 0, fmt.Errorf("sync photo: %w", err)
	}
	return written, nil
}

func sanitizeFilename(raw, ext string) string {
	base := filepath.Base(strings.TrimSpace(raw))
	if base == "." || base == "/" || base == "" {
		base = "photo" + ext
	}
	// Strip risky characters but keep something readable for DocuWare.
	cleaned := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '-', r == '_':
			return r
		default:
			return '_'
		}
	}, base)
	if !strings.Contains(cleaned, ".") {
		cleaned += ext
	}
	if len(cleaned) > 120 {
		cleaned = cleaned[:120]
	}
	return cleaned
}

// ContentTypeFromExt is a small helper for the worker so it can re-derive
// a content type from an extension when uploading to DocuWare.
func ContentTypeFromExt(name string) string {
	if ct := mime.TypeByExtension(strings.ToLower(filepath.Ext(name))); ct != "" {
		return ct
	}
	return "application/octet-stream"
}
