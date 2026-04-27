package receiving

// GRN PDF renderer — Transvaal-whitelabelled "Goods Received Note".
// Layout matches the design supplied by the user: header with Transvaal
// brand block, customer/PO/DN/vehicle/weighbridge summary, line item
// table, totals box, receiving notes block, signature panels, footer.
//
// Pure-Go via go-pdf/fpdf so the API binary has no system dependencies.

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/go-pdf/fpdf"
)

//go:embed assets/transvaal.png
var transvaalLogoPNG []byte

// brand colours
var (
	brandBlue    = rgb(34, 112, 195)  // header accent
	textPrimary  = rgb(31, 41, 55)    // near-black
	textMuted    = rgb(107, 114, 128) // grey
	rule         = rgb(229, 231, 235) // subtle dividers
	amberBg      = rgb(254, 243, 199) // receiving-notes block
	amberBorder  = rgb(245, 158, 11)
	totalsBg     = rgb(243, 244, 246)
	condChipBg   = rgb(238, 242, 255)
	condChipText = rgb(67, 56, 202)
)

// CompanyDetails carries the static branding shown in the header / footer.
// Using a struct so a second tenant or test fixture can swap the values
// without forking the renderer.
type CompanyDetails struct {
	Name       string
	AddressLn1 string
	Phone      string
	Email      string
	VAT        string
	Reg        string
}

var TransvaalCompany = CompanyDetails{
	Name:       "Transvaal Galvanisers",
	AddressLn1: "3 3rd Avenue, Voorsterkroon, Nigel 1491",
	Phone:      "+27 11 739 6000",
	Email:      "info@transvaalgalv.co.za",
	VAT:        "VAT 4030104541",
	Reg:        "Reg M1985/001541/07",
}

// GRNRenderInput is everything the renderer needs to lay out the page.
type GRNRenderInput struct {
	GRNNumber          string
	IssuedAt           time.Time
	SourcePODReference string

	CustomerName            string
	PurchaseOrderNumber     string
	DeliveryNoteNumber      string
	VehicleRegistration     string
	WeighbridgeTicketNumber string
	ReceivedAt              time.Time
	JobComments             string

	Lines []GRNRenderLine
}

type GRNRenderLine struct {
	LineNumber       int
	ItemCode         string
	Description      string
	ConditionSummary string  // populated when a defect was flagged
	ExpectedQty      float64
	ReceivedQty      float64
	UnitOfMeasure    string
	UnitWeightKg     float64 // per-unit weight; multiplied for line total
	LineWeightKg     float64
}

// tr is the active UTF-8 → cp1252 translator. Helvetica in fpdf uses
// WinAnsi encoding; passing raw UTF-8 produces mojibake (e.g. "·" → "Â·",
// "—" → "â€”"). We wrap every user-visible string through this.
type renderCtx struct {
	pdf *fpdf.Fpdf
	tr  func(string) string
}

func (r renderCtx) cell(w, h float64, s, border string, ln int, align string, fill bool, link int, linkStr string) {
	r.pdf.CellFormat(w, h, r.tr(s), border, ln, align, fill, link, linkStr)
}

// RenderGRNPDF builds the PDF and returns the raw bytes.
func RenderGRNPDF(input GRNRenderInput, company CompanyDetails) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(15, 15, 15)
	pdf.SetAutoPageBreak(true, 15)

	tr := pdf.UnicodeTranslatorFromDescriptor("cp1252")
	pdf.SetTitle(tr("Goods Received Note "+input.GRNNumber), false)
	pdf.SetCreator(tr(company.Name+" — Receiving App"), false)
	pdf.AliasNbPages("")

	// Register the embedded logo once per document so drawHeader can place it
	// without re-decoding. RegisterImageOptionsReader stores it under "logo".
	if len(transvaalLogoPNG) > 0 {
		pdf.RegisterImageOptionsReader("logo",
			fpdf.ImageOptions{ImageType: "PNG", ReadDpi: false},
			bytes.NewReader(transvaalLogoPNG))
	}

	ctx := renderCtx{pdf: pdf, tr: tr}

	// Render the footer on every page natively. Doing it via SetFooterFunc
	// avoids the manual SetY(-12) at the end of the document, which was
	// triggering an unwanted extra page-break with a footer-only page 2.
	pdf.SetFooterFunc(func() {
		pdf.SetY(-12)
		pdf.SetFont("Helvetica", "", 7)
		pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
		ctx.cell(0, 4,
			fmt.Sprintf("This GRN is generated from the signed POD on file in DocuWare. · Page %d of {nb} · %s",
				pdf.PageNo(), input.GRNNumber),
			"", 0, "C", false, 0, "")
	})

	pdf.AddPage()

	drawHeader(ctx, input, company)
	drawSummaryBlock(ctx, input)
	drawLineTable(ctx, input)
	totals := computeTotals(input)
	drawTotalsBox(ctx, totals)
	drawReceivingNotes(ctx, input)
	drawSignatureBlock(ctx)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("render grn pdf: %w", err)
	}
	if pdf.Err() {
		return nil, fmt.Errorf("render grn pdf: %s", pdf.Error())
	}
	return buf.Bytes(), nil
}

// ── Header ───────────────────────────────────────────────────────────────────

func drawHeader(ctx renderCtx, in GRNRenderInput, c CompanyDetails) {
	pdf := ctx.pdf
	// Layout (mm): page 210 wide, margins 15/15. Left brand block from
	// x=15 occupies up to x=110; right meta block starts at x=120 to
	// x=195 (75mm wide). This split prevents overprint when GRN numbers
	// are long like "GRN-SUB-000012178-2C995AFE".
	x, y := pdf.GetXY()
	// Real Transvaal logo (embedded), falling back to a brand square if the
	// asset isn't available — keeps the renderer safe to run in tests.
	logoSize := 16.0
	if len(transvaalLogoPNG) > 0 {
		pdf.ImageOptions("logo", x, y, logoSize, logoSize,
			false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	} else {
		pdf.SetFillColor(brandBlue.r, brandBlue.g, brandBlue.b)
		pdf.RoundedRect(x, y, logoSize, logoSize, 2, "1234", "F")
		pdf.SetFont("Helvetica", "B", 11)
		pdf.SetTextColor(255, 255, 255)
		pdf.SetXY(x, y+4.5)
		ctx.cell(logoSize, 7, "TG", "", 0, "C", false, 0, "")
	}

	// Company name + contact info on the left, capped at 90mm wide.
	leftW := 90.0
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	pdf.SetFont("Helvetica", "B", 13)
	pdf.SetXY(x+20, y+1)
	ctx.cell(leftW, 6, c.Name, "", 0, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 7.5)
	pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
	pdf.SetXY(x+20, y+7.5)
	ctx.cell(leftW, 4, fmt.Sprintf("%s · %s", c.AddressLn1, c.Phone), "", 0, "L", false, 0, "")
	pdf.SetXY(x+20, y+11.5)
	ctx.cell(leftW, 4, c.Email, "", 0, "L", false, 0, "")
	pdf.SetXY(x+20, y+15.5)
	ctx.cell(leftW, 4, fmt.Sprintf("%s · %s", c.VAT, c.Reg), "", 0, "L", false, 0, "")

	// Right meta block: 75mm wide starting at x=120.
	rightX := 120.0
	rightW := 75.0
	pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
	pdf.SetFont("Helvetica", "B", 8)
	pdf.SetXY(rightX, y)
	ctx.cell(rightW, 4, "GOODS RECEIVED NOTE", "", 0, "R", false, 0, "")
	// Auto-shrink the GRN number font to fit the right block — long
	// composite numbers (e.g. GRN-SUB-000012178-2C995AFE) won't fit at 16pt.
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	grnFont := fitFontSize(pdf, in.GRNNumber, "B", 16, 9, rightW)
	pdf.SetFont("Helvetica", "B", grnFont)
	pdf.SetXY(rightX, y+5)
	ctx.cell(rightW, 8, in.GRNNumber, "", 0, "R", false, 0, "")
	pdf.SetFont("Helvetica", "", 8)
	pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
	pdf.SetXY(rightX, y+14)
	ctx.cell(rightW, 4, "Issued "+in.IssuedAt.Format("2 January 2006"), "", 0, "R", false, 0, "")
	if in.SourcePODReference != "" {
		pdf.SetXY(rightX, y+18)
		ctx.cell(rightW, 4, "Source POD · "+in.SourcePODReference, "", 0, "R", false, 0, "")
	}

	pdf.SetXY(x, y+24)
	pdf.SetDrawColor(brandBlue.r, brandBlue.g, brandBlue.b)
	pdf.SetLineWidth(0.8)
	pdf.Line(15, y+25.5, 195, y+25.5)
	pdf.Ln(8)
}

// fitFontSize shrinks a font size until the rendered string fits within
// maxWidth, but never below minSize.
func fitFontSize(pdf *fpdf.Fpdf, s, style string, maxSize, minSize, maxWidth float64) float64 {
	for size := maxSize; size > minSize; size -= 0.5 {
		pdf.SetFont("Helvetica", style, size)
		if pdf.GetStringWidth(s) <= maxWidth {
			return size
		}
	}
	return minSize
}

// ── Summary block (Customer, PO, DN, Vehicle, Weighbridge, Received) ────────

func drawSummaryBlock(ctx renderCtx, in GRNRenderInput) {
	pdf := ctx.pdf
	type kv struct{ Label, Value string }
	rows := []kv{
		{"CUSTOMER", in.CustomerName},
		{"PURCHASE ORDER", in.PurchaseOrderNumber},
		{"DELIVERY NOTE", in.DeliveryNoteNumber},
		{"VEHICLE", in.VehicleRegistration},
		{"WEIGHBRIDGE", in.WeighbridgeTicketNumber},
		{"RECEIVED", formatReceivedDate(in.ReceivedAt)},
	}
	colW := 60.0
	rowH := 11.0
	// Capture the starting y *once*. The previous version recalculated it
	// inside the loop after pdf.GetY() had been mutated by SetXY, which
	// caused each row to drift further down — the visible "splay" of the
	// PURCHASE ORDER / DELIVERY NOTE / VEHICLE labels.
	startY := pdf.GetY()
	for i, r := range rows {
		col := i % 3
		row := i / 3
		x := 15 + float64(col)*colW
		y := startY + float64(row)*rowH

		pdf.SetXY(x, y)
		pdf.SetFont("Helvetica", "B", 7)
		pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
		ctx.cell(colW, 3.5, r.Label, "", 0, "L", false, 0, "")

		pdf.SetXY(x, y+4)
		pdf.SetFont("Helvetica", "B", 10)
		pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
		val := r.Value
		if strings.TrimSpace(val) == "" {
			val = "—"
			pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
			pdf.SetFont("Helvetica", "", 10)
		}
		ctx.cell(colW, 5, val, "", 0, "L", false, 0, "")
	}
	endY := startY + 2*rowH + 2
	pdf.SetY(endY)

	pdf.SetDrawColor(rule.r, rule.g, rule.b)
	pdf.SetLineWidth(0.2)
	pdf.Line(15, endY, 195, endY)
	pdf.Ln(4)
}

// ── Line table ──────────────────────────────────────────────────────────────

type lineCol struct {
	label string
	w     float64
	align string
}

func drawLineTable(ctx renderCtx, in GRNRenderInput) {
	pdf := ctx.pdf
	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	ctx.cell(0, 6, "LINE ITEMS", "", 1, "L", false, 0, "")
	pdf.Ln(1)

	// Column widths sum to 180 mm (page width 195 - margins 30 + already at x=15)
	// Total width 180mm. CODE widened from 22→32 to fit typical item codes
	// like "60RND-EN-19-02" without bleeding into DESCRIPTION; description
	// shrinks to 60 and we keep a small left padding via cell-internal
	// alignment.
	cols := []lineCol{
		{"#", 8, "L"},
		{"CODE", 32, "L"},
		{"DESCRIPTION", 60, "L"},
		{"EXP", 12, "R"},
		{"REC'D", 14, "R"},
		{"UNIT", 12, "C"},
		{"KG/U", 18, "R"},
		{"LINE KG", 24, "R"},
	}

	pdf.SetFont("Helvetica", "B", 7)
	pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
	for _, c := range cols {
		ctx.cell(c.w, 5, c.label, "", 0, c.align, false, 0, "")
	}
	pdf.Ln(5)
	pdf.SetDrawColor(rule.r, rule.g, rule.b)
	pdf.Line(15, pdf.GetY(), 195, pdf.GetY())
	pdf.Ln(1)

	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	for _, ln := range in.Lines {
		drawLineRow(ctx, cols, ln)
	}
}

func drawLineRow(ctx renderCtx, cols []lineCol, ln GRNRenderLine) {
	pdf := ctx.pdf
	pdf.SetFont("Helvetica", "", 9)

	values := []struct {
		text  string
		align string
	}{
		{fmt.Sprintf("%02d", ln.LineNumber), "L"},
		{ln.ItemCode, "L"},
		{ln.Description, "L"},
		{formatQty(ln.ExpectedQty), "R"},
		{formatQty(ln.ReceivedQty), "R"},
		{ln.UnitOfMeasure, "C"},
		{formatKg(ln.UnitWeightKg), "R"},
		{formatKg(ln.LineWeightKg), "R"},
	}

	for i, c := range cols {
		ctx.cell(c.w, 6, values[i].text, "", 0, values[i].align, false, 0, "")
	}
	pdf.Ln(5)

	if pretty := PrettyConditionSummary(ln.ConditionSummary); pretty != "" {
		// Indent under the description column, render as a soft chip + text.
		x := 15 + cols[0].w + cols[1].w
		pdf.SetXY(x, pdf.GetY())
		drawConditionChip(ctx, pretty, cols[2].w+cols[3].w+cols[4].w)
		pdf.Ln(5)
	}

	// Subtle row divider
	pdf.SetDrawColor(rule.r, rule.g, rule.b)
	pdf.Line(15, pdf.GetY(), 195, pdf.GetY())
	pdf.Ln(1.5)
}

func drawConditionChip(ctx renderCtx, summary string, maxW float64) {
	pdf := ctx.pdf
	tag := "CONDITION"
	pdf.SetFont("Helvetica", "B", 6)
	tagW := pdf.GetStringWidth(tag) + 4
	x, y := pdf.GetXY()
	pdf.SetFillColor(condChipBg.r, condChipBg.g, condChipBg.b)
	pdf.RoundedRect(x, y, tagW, 4, 1, "1234", "F")
	pdf.SetTextColor(condChipText.r, condChipText.g, condChipText.b)
	pdf.SetXY(x, y)
	ctx.cell(tagW, 4, tag, "", 0, "C", false, 0, "")

	pdf.SetFont("Helvetica", "", 8)
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	pdf.SetX(x + tagW + 2)
	ctx.cell(maxW-tagW-2, 4, summary, "", 0, "L", false, 0, "")
}

// ── Totals box ──────────────────────────────────────────────────────────────

type grnTotals struct {
	expectedUnits float64
	receivedUnits float64
	variance      float64
	netMassKg     float64
}

func computeTotals(in GRNRenderInput) grnTotals {
	var t grnTotals
	for _, ln := range in.Lines {
		t.expectedUnits += ln.ExpectedQty
		t.receivedUnits += ln.ReceivedQty
		t.netMassKg += ln.LineWeightKg
	}
	t.variance = t.receivedUnits - t.expectedUnits
	return t
}

func drawTotalsBox(ctx renderCtx, t grnTotals) {
	pdf := ctx.pdf
	pdf.Ln(2)
	x := 110.0
	w := 85.0
	y := pdf.GetY()
	rowH := 5.5

	// Estimated net mass is only shown when we actually have weight data;
	// otherwise printing "— kg" looks broken (the dash is the unit's empty
	// marker, the kg suffix becomes nonsense).
	showNetMass := t.netMassKg > 0
	totalRows := 3
	if showNetMass {
		totalRows = 4
	}
	boxH := rowH*float64(totalRows) + 4

	pdf.SetFillColor(totalsBg.r, totalsBg.g, totalsBg.b)
	pdf.SetDrawColor(rule.r, rule.g, rule.b)
	pdf.RoundedRect(x, y, w, boxH, 2, "1234", "FD")

	rows := []struct {
		label string
		value string
		bold  bool
	}{
		{"Total expected units", formatQty(t.expectedUnits), false},
		{"Total received units", formatQty(t.receivedUnits), false},
		{"Variance", formatVariance(t.variance), false},
	}
	if showNetMass {
		rows = append(rows, struct {
			label string
			value string
			bold  bool
		}{"Estimated net mass received", formatKg(t.netMassKg) + " kg", true})
	}
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	for i, r := range rows {
		py := y + 2 + float64(i)*rowH
		pdf.SetXY(x+4, py)
		if r.bold {
			pdf.SetFont("Helvetica", "B", 9)
			pdf.SetTextColor(brandBlue.r, brandBlue.g, brandBlue.b)
		} else {
			pdf.SetFont("Helvetica", "", 9)
			pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
		}
		ctx.cell(w-50, rowH, r.label, "", 0, "L", false, 0, "")
		pdf.SetX(x + w - 46)
		pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
		if r.bold {
			pdf.SetFont("Helvetica", "B", 10)
			pdf.SetTextColor(brandBlue.r, brandBlue.g, brandBlue.b)
		}
		ctx.cell(42, rowH, r.value, "", 0, "R", false, 0, "")
	}
	pdf.SetY(y + boxH + 4)
}

// ── Receiving notes ─────────────────────────────────────────────────────────

func drawReceivingNotes(ctx renderCtx, in GRNRenderInput) {
	pdf := ctx.pdf
	notes := strings.TrimSpace(in.JobComments)

	type flagged struct {
		line    GRNRenderLine
		summary string
	}
	flaggedLines := []flagged{}
	for _, ln := range in.Lines {
		if pretty := PrettyConditionSummary(ln.ConditionSummary); pretty != "" {
			flaggedLines = append(flaggedLines, flagged{line: ln, summary: pretty})
		}
	}
	if notes == "" && len(flaggedLines) == 0 {
		return
	}

	x := 15.0
	w := 180.0
	y := pdf.GetY()
	rows := 1
	if notes != "" {
		rows++
	}
	rows += len(flaggedLines)
	h := 6 + float64(rows)*5

	pdf.SetFillColor(amberBg.r, amberBg.g, amberBg.b)
	pdf.SetDrawColor(amberBorder.r, amberBorder.g, amberBorder.b)
	pdf.SetLineWidth(0.4)
	pdf.RoundedRect(x, y, w, h, 2, "1234", "FD")

	pdf.SetXY(x+4, y+2)
	pdf.SetFont("Helvetica", "B", 8)
	pdf.SetTextColor(amberBorder.r, amberBorder.g, amberBorder.b)
	ctx.cell(w-8, 5, "RECEIVING NOTES", "", 1, "L", false, 0, "")

	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(textPrimary.r, textPrimary.g, textPrimary.b)
	if notes != "" {
		pdf.SetX(x + 4)
		ctx.cell(w-8, 5, notes, "", 1, "L", false, 0, "")
	}
	for _, f := range flaggedLines {
		pdf.SetX(x + 4)
		pdf.SetFont("Helvetica", "B", 9)
		label := fmt.Sprintf("Line %d — %s", f.line.LineNumber, f.line.Description)
		ctx.cell(60, 5, label, "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
		ctx.cell(w-68, 5, f.summary, "", 1, "L", false, 0, "")
	}
	pdf.SetY(y + h + 4)
}

// ── Signature block ─────────────────────────────────────────────────────────

func drawSignatureBlock(ctx renderCtx) {
	pdf := ctx.pdf
	// Place the signature block immediately below preceding content with a
	// small gap. Previous version forced y=230 and added a new page when
	// content overflowed past 240 — that pushed everything onto a near-empty
	// page when the rest of the page had room, producing a blank page 2.
	pdf.Ln(8)
	y := pdf.GetY()
	pageH := 297.0
	bottomMargin := 18.0
	blockH := 25.0
	if y+blockH > pageH-bottomMargin {
		pdf.AddPage()
		y = pdf.GetY()
	}
	w := 85.0
	gap := 10.0

	pdf.SetDrawColor(rule.r, rule.g, rule.b)
	pdf.SetLineWidth(0.4)

	pdf.RoundedRect(15, y, w, 16, 2, "1234", "D")
	pdf.RoundedRect(15+w+gap, y, w, 16, 2, "1234", "D")

	pdf.SetFont("Helvetica", "B", 7)
	pdf.SetTextColor(textMuted.r, textMuted.g, textMuted.b)
	pdf.SetXY(15, y+18)
	ctx.cell(w, 4, "RECEIVED BY — TRANSVAAL GALVANISERS", "", 0, "L", false, 0, "")
	pdf.SetXY(15+w+gap, y+18)
	ctx.cell(w, 4, "DELIVERED BY — DRIVER", "", 0, "L", false, 0, "")

	pdf.SetFont("Helvetica", "", 7)
	pdf.SetXY(15, y+22)
	ctx.cell(w, 4, "Name, date, signature", "", 0, "L", false, 0, "")
	pdf.SetXY(15+w+gap, y+22)
	ctx.cell(w, 4, "Name, date, signature", "", 0, "L", false, 0, "")
}


// ── helpers ─────────────────────────────────────────────────────────────────

type rgbColor struct{ r, g, b int }

func rgb(r, g, b int) rgbColor { return rgbColor{r, g, b} }

func formatReceivedDate(t time.Time) string {
	if t.IsZero() {
		return "—"
	}
	return t.Format("2 Jan 2006")
}

func formatQty(v float64) string {
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func formatKg(v float64) string {
	if v == 0 {
		return "—"
	}
	if v == float64(int64(v)) {
		return strconv.FormatInt(int64(v), 10)
	}
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func formatVariance(v float64) string {
	if v == 0 {
		return "0"
	}
	if v > 0 {
		return "+" + formatQty(v)
	}
	return formatQty(v)
}

// Write streams the PDF into w (used by handlers that want to avoid an
// intermediate buffer; today the GRN service uses the byte-slice form).
func Write(w io.Writer, b []byte) error {
	_, err := w.Write(b)
	return err
}

// PrettyConditionSummary turns a condition_notes JSON blob — the shape
// emitted by buildConditionNotes() in the frontend — into a human-readable
// one-liner suitable for the GRN. Falls back to the raw string if the
// input isn't JSON (legacy free-text notes).
//
// Example input:
//
//	{"oilGreaseDiesel":"a lot","additionalComments":"check the seam"}
//
// Output:
//
//	Oil/grease/diesel: a lot · Notes: check the seam
func PrettyConditionSummary(notes string) string {
	notes = strings.TrimSpace(notes)
	if notes == "" {
		return ""
	}
	if !strings.HasPrefix(notes, "{") {
		// Pre-JSON free-text or unrelated string — return as-is, capped.
		return clip(notes, 200)
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(notes), &raw); err != nil {
		return clip(notes, 200)
	}

	// Pull additionalComments out for separate handling, drop *Mitigation
	// keys (operational details, not for the GRN one-liner) and zero-valued
	// hole-count keys (boilerplate from the legacy editor).
	additional, _ := raw["additionalComments"].(string)
	delete(raw, "additionalComments")

	type entry struct {
		key, label, value string
	}
	var entries []entry
	for k, v := range raw {
		if strings.HasSuffix(k, "Mitigation") {
			continue
		}
		val := formatConditionValue(v)
		if val == "" {
			continue
		}
		entries = append(entries, entry{key: k, label: prettifyKey(k), value: val})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].key < entries[j].key })

	var parts []string
	for _, e := range entries {
		if e.value == "yes" || e.value == "true" {
			parts = append(parts, e.label)
		} else {
			parts = append(parts, e.label+": "+e.value)
		}
	}
	if strings.TrimSpace(additional) != "" {
		parts = append(parts, "Notes: "+strings.TrimSpace(additional))
	}
	if len(parts) == 0 {
		return ""
	}
	return clip(strings.Join(parts, " · "), 220)
}

// formatConditionValue normalises a raw JSON value to a human string.
// Bools become "yes"/"" (false drops out), zero numbers drop out,
// arrays join with ", ".
func formatConditionValue(v any) string {
	switch t := v.(type) {
	case bool:
		if t {
			return "yes"
		}
		return ""
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t == 0 {
			return ""
		}
		return formatQty(t)
	case []any:
		parts := make([]string, 0, len(t))
		for _, item := range t {
			s := formatConditionValue(item)
			if s != "" {
				parts = append(parts, s)
			}
		}
		return strings.Join(parts, ", ")
	default:
		return ""
	}
}

// prettifyKey turns "oilGreaseDiesel" → "Oil/Grease/Diesel" using the
// camelCase split + a few canonical replacements. Falls back to the raw
// key for anything unrecognised.
func prettifyKey(k string) string {
	if pretty, ok := conditionKeyAliases[k]; ok {
		return pretty
	}
	// Split camelCase into words.
	var b strings.Builder
	for i, r := range k {
		if i > 0 && unicode.IsUpper(r) {
			b.WriteByte(' ')
		}
		if i == 0 {
			b.WriteRune(unicode.ToUpper(r))
		} else {
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// conditionKeyAliases captures specific labels we want to look better
// than auto-camelCase-split would produce. It's a soft override — adding
// to it is cheap, and missing entries still get a reasonable fallback.
var conditionKeyAliases = map[string]string{
	"oilGreaseDiesel":         "Oil/Grease/Diesel",
	"holesInadequate":         "Holes inadequate",
	"enclosedCavity":          "Enclosed cavity",
	"ventHolesQty":            "Vent holes",
	"drainHolesQty":           "Drain holes",
	"jigHolesQty":             "Jig holes",
	"cavityVentHolesQty":      "Cavity vent holes",
	"sharpEdges":              "Sharp edges",
	"contactWithGround":       "Contact with ground",
	"materialMarkingMissing":  "Material marking missing",
	"weldQuality":             "Weld quality",
	"surfaceContamination":    "Surface contamination",
	"physicalDamage":          "Physical damage",
	"rust":                    "Rust",
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
