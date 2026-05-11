package receiving

import (
	"context"
	"testing"
	"time"
)

func TestListReceiptsWithNilRepository(t *testing.T) {
	service := NewService(nil)

	receipts, err := service.ListReceipts(context.Background(), false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(receipts) != 0 {
		t.Fatalf("len(receipts) = %d, want 0", len(receipts))
	}
}

type stubRepository struct {
	listResult    []Receipt
	getResult     Receipt
	importResult  []Receipt
	importedInput []importedReceipt
	listErr       error
	getErr        error
	importErr     error
}

func (s *stubRepository) ListReceipts(_ context.Context, _ bool) ([]Receipt, error) {
	return s.listResult, s.listErr
}

func (s *stubRepository) ArchiveStaleMatched(_ context.Context, _ time.Duration) (int64, error) {
	return 0, nil
}

func (s *stubRepository) GetReceipt(context.Context, string) (Receipt, error) {
	return s.getResult, s.getErr
}

func (s *stubRepository) ImportDocuWareReceipts(_ context.Context, receipts []importedReceipt) ([]Receipt, error) {
	s.importedInput = receipts
	return s.importResult, s.importErr
}

func (s *stubRepository) CreateReceipt(_ context.Context, _ importedReceipt) (Receipt, error) {
	return Receipt{}, nil
}

func (s *stubRepository) UpdateReceipt(_ context.Context, _ string, _ UpdateReceiptInput) (Receipt, error) {
	return Receipt{}, nil
}

func (s *stubRepository) UpdateReceiptLine(_ context.Context, _ string, _ string, _ UpdateReceiptLineInput) (ReceiptLine, error) {
	return ReceiptLine{}, nil
}

func TestImportDocuWareRowsGroupsRowsIntoOneReceipt(t *testing.T) {
	repo := &stubRepository{
		importResult: []Receipt{{ID: "receipt-1", ReceiptNumber: "imported"}},
	}
	service := NewService(repo)

	result, err := service.ImportDocuWareRows(context.Background(), DocuWareImportInput{
		SourceCabinetID:  "198",
		SourceDocumentID: "doc-38-100",
		Rows: []DocuWareImportRow{
			{
				RecordID: "line-1",
				Payload: map[string]any{
					"DELIVERY_NOTE":              "DN-123",
					"ORDER_NUMBER":               "PO-1",
					"WEIGHBRIDGE_TICKET_NUMBER":  "WB-88",
					"FABRICATOR":                 "Fabricator A",
					"DNDOCID":                    "group-100",
					"LINE":                       "1",
					"ITEM_CODE_ON_DELIVERY_NOTE": "ITEM-1",
					"ITEM_NAME_ON_DELIVERY_NOTE": "Item One",
					"QUANTITY":                   "10",
					"QUANTITY_RECEIVED":          "4",
					"UNIQUE_NUMBER":              "UNIQ-1",
					"PRIMARY_KEY":                "PK-1",
					"COMMENTS":                   "Comment one",
					"DWSTOREDATETIME":            "2026-04-17T13:00:00Z",
				},
			},
			{
				RecordID: "line-2",
				Payload: map[string]any{
					"DELIVERY_NOTE":              "DN-123",
					"ORDER_NUMBER":               "PO-1",
					"WEIGHBRIDGE_TICKET_NUMBER":  "WB-88",
					"FABRICATOR":                 "Fabricator A",
					"DNDOCID":                    "group-100",
					"LINE":                       "2",
					"ITEM_CODE_ON_DELIVERY_NOTE": "ITEM-2",
					"ITEM_NAME_ON_DELIVERY_NOTE": "Item Two",
					"QUANTITY":                   "6",
					"QUANTITY_RECEIVED":          "0",
					"UNIQUE_NUMBER":              "UNIQ-2",
					"PRIMARY_KEY":                "PK-2",
					"COMMENTS":                   "Comment two",
					"DWSTOREDATETIME":            "2026-04-17T13:00:00Z",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.ImportedReceiptCount != 1 {
		t.Fatalf("imported receipt count = %d, want 1", result.ImportedReceiptCount)
	}

	if result.ImportedRowCount != 2 {
		t.Fatalf("imported row count = %d, want 2", result.ImportedRowCount)
	}

	if len(repo.importedInput) != 1 {
		t.Fatalf("len(importedInput) = %d, want 1", len(repo.importedInput))
	}

	imported := repo.importedInput[0]
	if imported.DocuWareGroupReference != "DN-123|WB-88" {
		t.Fatalf("group reference = %q", imported.DocuWareGroupReference)
	}

	if imported.SourceDocuWareDocument != "doc-38-100" {
		t.Fatalf("source document id = %q, want doc-38-100", imported.SourceDocuWareDocument)
	}

	if len(imported.Lines) != 2 {
		t.Fatalf("len(imported.Lines) = %d, want 2", len(imported.Lines))
	}

	if imported.Lines[0].ItemCode != "ITEM-1" {
		t.Fatalf("first line item code = %q, want ITEM-1", imported.Lines[0].ItemCode)
	}

	if imported.Lines[1].DocuWareRecordLine != "UNIQ-2" {
		t.Fatalf("second line record id = %q, want UNIQ-2", imported.Lines[1].DocuWareRecordLine)
	}
}

func TestImportDocuWareRowsRejectsMissingRecordID(t *testing.T) {
	service := NewService(&stubRepository{})

	_, err := service.ImportDocuWareRows(context.Background(), DocuWareImportInput{
		Rows: []DocuWareImportRow{{Payload: map[string]any{"DELIVERY_NOTE": "DN-1"}}},
	})
	if err == nil {
		t.Fatalf("expected error, got nil")
	}
}

func TestImportDocuWareRowsDerivesSourceIdentifiersFromPayload(t *testing.T) {
	repo := &stubRepository{
		importResult: []Receipt{{ID: "receipt-1", ReceiptNumber: "imported"}},
	}
	service := NewService(repo)

	_, err := service.ImportDocuWareRows(context.Background(), DocuWareImportInput{
		Rows: []DocuWareImportRow{{
			Payload: map[string]any{
				"DWDOCID":       "line-1",
				"DNDOCID":       "source-doc-100",
				"DWSYS_FC_GUID": "cabinet-guid-198",
				"DELIVERY_NOTE": "DN-123",
			},
		}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(repo.importedInput) != 1 {
		t.Fatalf("len(importedInput) = %d, want 1", len(repo.importedInput))
	}

	imported := repo.importedInput[0]
	if imported.SourceDocuWareDocument != "source-doc-100" {
		t.Fatalf("source document id = %q, want source-doc-100", imported.SourceDocuWareDocument)
	}

	if imported.SourceDocuWareCabinet != "cabinet-guid-198" {
		t.Fatalf("source cabinet id = %q, want cabinet-guid-198", imported.SourceDocuWareCabinet)
	}

	if imported.Lines[0].DocuWareRecordLine != "line-1" {
		t.Fatalf("line record id = %q, want line-1", imported.Lines[0].DocuWareRecordLine)
	}
}

func fatalf(format string, args ...any) {
	panicf := false
	_ = panicf
}
