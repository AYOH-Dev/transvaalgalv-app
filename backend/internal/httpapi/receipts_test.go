package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeDocuWareImportInputAcceptsNativeFlatPayload(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", strings.NewReader(`{
		"DWDOCID": "line-1",
		"DNDOCID": "source-doc-100",
		"DWSYS_FC_GUID": "cabinet-guid-198",
		"DELIVERY_NOTE": "DN-123"
	}`))

	request, err := decodeDocuWareImportInput(req, "configured-cabinet-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if request.SourceCabinetID != "cabinet-guid-198" {
		t.Fatalf("source cabinet id = %q, want cabinet-guid-198", request.SourceCabinetID)
	}

	if request.SourceDocumentID != "source-doc-100" {
		t.Fatalf("source document id = %q, want source-doc-100", request.SourceDocumentID)
	}

	if len(request.Rows) != 1 {
		t.Fatalf("len(rows) = %d, want 1", len(request.Rows))
	}

	if request.Rows[0].RecordID != "line-1" {
		t.Fatalf("record id = %q, want line-1", request.Rows[0].RecordID)
	}

	if request.Rows[0].Payload["DELIVERY_NOTE"] != "DN-123" {
		t.Fatalf("payload delivery note = %v, want DN-123", request.Rows[0].Payload["DELIVERY_NOTE"])
	}
}

func TestDecodeDocuWareImportInputAcceptsWrappedPayload(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", strings.NewReader(`{
		"source_document_id": "source-doc-100",
		"rows": [
			{
				"payload": {
					"DWDOCID": "line-1",
					"DELIVERY_NOTE": "DN-123"
				}
			}
		]
	}`))

	request, err := decodeDocuWareImportInput(req, "configured-cabinet-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if request.SourceCabinetID != "configured-cabinet-id" {
		t.Fatalf("source cabinet id = %q, want configured-cabinet-id", request.SourceCabinetID)
	}

	if request.SourceDocumentID != "source-doc-100" {
		t.Fatalf("source document id = %q, want source-doc-100", request.SourceDocumentID)
	}

	if request.Rows[0].RecordID != "line-1" {
		t.Fatalf("record id = %q, want line-1", request.Rows[0].RecordID)
	}
}

func TestDecodeDocuWareImportInputAcceptsPayloadArray(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/integrations/docuware/imports", strings.NewReader(`[
		{
			"DWDOCID": "line-1",
			"DNDOCID": "source-doc-100",
			"DELIVERY_NOTE": "DN-123"
		},
		{
			"DWDOCID": "line-2",
			"DNDOCID": "source-doc-100",
			"DELIVERY_NOTE": "DN-123"
		}
	]`))

	request, err := decodeDocuWareImportInput(req, "configured-cabinet-id")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(request.Rows) != 2 {
		t.Fatalf("len(rows) = %d, want 2", len(request.Rows))
	}

	if request.SourceDocumentID != "source-doc-100" {
		t.Fatalf("source document id = %q, want source-doc-100", request.SourceDocumentID)
	}

	if request.Rows[1].RecordID != "line-2" {
		t.Fatalf("second record id = %q, want line-2", request.Rows[1].RecordID)
	}
}
