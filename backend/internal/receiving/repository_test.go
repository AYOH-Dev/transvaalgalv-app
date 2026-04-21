package receiving

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestResolveImportedReceiptLookup(t *testing.T) {
	tests := []struct {
		name           string
		lookupErr      error
		existingStatus string
		wantInsertNew  bool
		wantErr        error
	}{
		{
			name:          "missing receipt inserts new row",
			lookupErr:     pgx.ErrNoRows,
			wantInsertNew: true,
		},
		{
			name:           "draft receipt updates existing row",
			existingStatus: string(ReceiptStatusDraft),
		},
		{
			name:           "non-draft receipt conflicts",
			existingStatus: string(ReceiptStatusReceived),
			wantErr:        ErrConflict,
		},
		{
			name:      "unexpected lookup error is wrapped",
			lookupErr: errors.New("boom"),
			wantErr:   errors.New("lookup imported receipt: boom"),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			insertNew, err := resolveImportedReceiptLookup(test.lookupErr, test.existingStatus)

			if insertNew != test.wantInsertNew {
				t.Fatalf("insertNew = %t, want %t", insertNew, test.wantInsertNew)
			}

			switch {
			case test.wantErr == nil && err != nil:
				t.Fatalf("err = %v, want nil", err)
			case test.wantErr != nil && err == nil:
				t.Fatalf("err = nil, want %v", test.wantErr)
			case test.wantErr != nil && err != nil && err.Error() != test.wantErr.Error():
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
		})
	}
}
