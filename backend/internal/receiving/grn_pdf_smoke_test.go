package receiving

import (
	"os"
	"testing"
	"time"
)

// TestRenderGRNPDF_Smoke generates a representative GRN to /tmp/grn_smoke.pdf
// so the result can be eyeballed after layout changes (no asserts — visual
// confirmation only). Skips outside the dev box.
func TestRenderGRNPDF_Smoke(t *testing.T) {
	if os.Getenv("GRN_SMOKE") == "" {
		t.Skip("set GRN_SMOKE=1 to write /tmp/grn_smoke.pdf")
	}
	in := GRNRenderInput{
		GRNNumber:               "GRN-SUB-000012178-2C995AFE",
		IssuedAt:                time.Now(),
		SourcePODReference:      "DN-12345",
		CustomerName:            "Acme Steel Co. (Pty) Ltd",
		PurchaseOrderNumber:     "PO-2025-99987",
		DeliveryNoteNumber:      "DN-2025-12345",
		VehicleRegistration:     "GP 123-456",
		WeighbridgeTicketNumber: "WB-789012",
		ReceivedAt:              time.Now(),
		JobComments:             "This is a longer comment that should wrap nicely inside the receiving notes amber box. It must not overflow past the rounded-rect boundary on the right edge of the document at any time even when it goes on and on.",
		Lines: []GRNRenderLine{
			{LineNumber: 1, ItemCode: "IC100", Description: "Angle 50x50x6mm", ExpectedQty: 952, ReceivedQty: 952, UnitOfMeasure: "pcs"},
			{LineNumber: 21, ItemCode: "IC662", Description: "Plate 8mm 1200x2400 mild steel", ExpectedQty: 875, ReceivedQty: 870, UnitOfMeasure: "pcs",
				ConditionSummary: `{"holesInadequate":true,"holesInadequateMitigation":["Vent holes required","Drain holes required","Jig holes required"],"ventHolesQty":1,"drainHolesQty":1,"jigHolesQty":1,"enclosedCavity":true,"enclosedCavityMitigation":["Cavity Vent holes required"],"cavityVentHolesQty":1,"additionalComments":"TestNotes at the end of delivery note that needs to wrap onto a second line so we know the receiving notes box grows"}`},
			{LineNumber: 44, ItemCode: "IC988", Description: "Angle 75mm", ExpectedQty: 100, ReceivedQty: 100, UnitOfMeasure: "pcs",
				ConditionSummary: `{"additionalComments":"Some additional notes upon receipt"}`},
		},
	}
	b, err := RenderGRNPDF(in, TransvaalCompany)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("/tmp/grn_smoke.pdf", b, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote /tmp/grn_smoke.pdf (%d bytes)", len(b))
}
