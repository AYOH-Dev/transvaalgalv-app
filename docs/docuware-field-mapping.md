# DocuWare Receiving Data — Field Mapping Reference

**Cabinet:** Receiving Data (ID: 198)  
**Sync direction:** Receiving App → DocuWare (write-back)  
**Record structure:** One DocuWare record per delivery line (flat, not table-based)  
**Last reviewed:** May 2026

---

## How Sync Works

When a user saves changes to a line in the Receiving App (Yard or Receipts view), the app writes the updated values back to the corresponding DocuWare record using the `DWDOCID` stored on each line.

- **Status changes** (marking a line as Received) sync immediately.
- **All other field changes** (quantities, descriptions, defects, etc.) are queued and processed by the background sync worker within the configured interval (default 30 seconds).

---

## Receipt Header Fields

These fields are repeated on every line record for the same delivery.

| DocuWare Field | App Source | Notes |
|---|---|---|
| `COMPANY` | Customer name | |
| `FABRICATOR` | Supplier / fabricator name | |
| `DELIVERY_NOTE` | Delivery note number | |
| `ORDER_NUMBER` | Purchase order number | |
| `WEIGHBRIDGE_TICKET_NUMBER` | Weighbridge ticket number | |
| `VEHICLE_REGISTRATION` | Vehicle registration | |
| `JOB_NUMBER` | Job number | |
| `RECEIVED_BY` | Display name of confirming user | Only populated once a line is marked Received |

---

## Line Identity & Description Fields

| DocuWare Field | App Source | Notes |
|---|---|---|
| `ITEM_CODE_ON_DELIVERY_NOTE` | Item code | As captured from POD; editable by office |
| `MATERIAL_DESCRIPTION` | Description | As captured from POD; editable by office |
| `INTERNAL_DESCRIPTION` | Internal description | Set by receiving/office staff |
| `MATERIAL_CODE` | Material code | From POD import |
| `MATERIAL_SIZE` | Item size | From POD import; editable by office |
| `MATERIAL_MARKINGS` | Material markings | From POD import |
| `MATERIAL_THICKNESS` | Thickness | From POD import; editable by office |
| `MATERIAL_LENGTH` | Length | From POD import |
| `ITEM_TYPE` | Item type | `blacksteel` / `galvanised` / `other` |
| `WEIGHT` | Weight | From POD import |

---

## Quantity & Location Fields

| DocuWare Field | App Source | Notes |
|---|---|---|
| `QUANTITY` | Expected quantity | As received from POD |
| `QUANTITY_RECEIVED` | Received quantity | Captured during receiving |
| `QUANTITY_DISCREPANCY` | Quantity discrepancy | `none` / `short` / `over` |
| `DISCREPANCY` | Discrepancy notes | Free text; `defects_noted` for defect lines |
| `RECEIVING_STATUS` | Receiving status | `Draft` / `Received` / `Quality Hold` / `Matched` / `Archived` |
| `PROCESS` | Galvanising process | e.g. `galvanising`, `regalvanising` |
| `PACKAGING_METHOD` | Packaging method | |
| `STORED_IN` | Storage area | Free text, e.g. "Cold room", "Warehouse B" |
| `BAY` | Storage bay | e.g. R1–R24, Plant 2~3, Shotblast |
| `ACCESSORIES` | Accessories | e.g. bolts, brackets |
| `REQUIRED_GALV_THICKNESS` | Required galv thickness | e.g. `85µm` |
| `COMMENTS` | General comments | |
| `ADDITIONAL_COMMENTS` | Additional comments from defect wizard | |

---

## Defect Flags

Each flag is only written when the defect is set to a **non-default** value. `DEFECT_DETECTED` is always written.

| DocuWare Field | Defect | Default | Possible Values |
|---|---|---|---|
| `DEFECT_DETECTED` | — | — | `Yes` / `No` |
| `PAINT` | Paint | `none` | `none` / `little` / `a lot` |
| `OIL_GREASE_DIESEL` | Oil, Grease or Diesel | `none` | `none` / `little` / `a lot` |
| `DAMAGED` | Damaged | `none` | `none` / `dented` / `bent` / `crack` / `deep scratch` / `multiple damages` |
| `BURR` | Burr | `none` | `none` / `little` / `a lot` |
| `WELDING_FLUX` | Welding Flux | `no` | `no` / `yes` |
| `SHARP_EDGES` | Sharp Edges | `no` | `no` / `yes` |
| `POSSIBLE_DISTORTION` | Possible Distortion | `no` | `no` / `possible` / `very likely (thickness <5mm)` |
| `RUST` | Rust | `normal` | `normal` / `porosity` / `irreparable` |
| `WELD_SPLATTER` | Welding or Cutting Splatter | `no` | `no` / `yes` |
| `DELAMINATION` | Delamination | `no` | `no` / `yes` |
| `NON_CONFORMING_PRE_GALV` | Non-Conforming Pre-Galvanization | `no` | `no` / `yes` |
| `PIN_HOLES` | Pin Holes | `none` | `none` / `few` / `a lot (porosity)` |
| `ENCLOSED_CAVITY` | Enclosed Cavity | `no` | `no` / `yes` |
| `HOLES_INADEQUATE` | Holes Inadequate | `no` | `no` / `yes` |
| `NO_HANGING_METHOD` | No Hanging Method | `no` | `no` / `yes` |
| `THREADED_ARTICLE` | Threaded Article | `no` | `no` / `yes` |
| `ARTICLE_OVERLAPPED` | Article Overlap/Continuous Weld | `no` | `no` / `yes` |
| `CONTINUOUS_WELD` | (same as above, legacy) | `no` | `no` / `yes` |

---

## Mitigation Fields

Written as comma-separated text when one or more mitigations are selected for a defect.

| DocuWare Field | Defect | Possible Mitigation Values |
|---|---|---|
| `PAINT_MITIGATION` | Paint | `Thinners required`, `Shotblasting required` |
| `DAMAGE_MITIGATION` | Damaged | `Send to boilershop` |
| `RUST_MITIGATION` | Rust | `Shotblasting required`, `Send to boilershop` |
| `DELAMINATION_MITIGATION` | Delamination | `Shotblasting required` |
| `NON_CONFORMING_PRE_GALV_MITIG` | Non-Conforming Pre-Galv | `Send to stripping` |
| `THREADED_ARTICLE_MITIGATION` | Threaded Article | `Galv stop required` |
| `ENCLOSED_CAVITY_HOLES_REQUIRE` | Enclosed Cavity | `Cavity Vent holes required` |
| `ARTICLE_OVERLAP_VENT_HOLES` | Article Overlap | `Article Overlap Vent Hole required` |

---

## Hole & Hanging Quantity Fields

| DocuWare Field | Source | Notes |
|---|---|---|
| `VENT_HOLES_REQUIRED` | Holes Inadequate → Vent holes qty | Numeric |
| `DRAIN_HOLES_REQUIRED` | Holes Inadequate → Drain holes qty | Numeric |
| `JIG_HOLE_REQUIRED` | Holes Inadequate → Jig holes qty | Numeric |
| `ENCLOSED_CAVITY_HOLES_QUANTIT` | Enclosed Cavity → Cavity vent holes qty | Numeric |
| `NO_HANGING_LIFTING_LUG_NUT_RE` | No Hanging → Lifting lug-nut required | Text flag |
| `NO_HANGING_LIFTING_LUG_NUT_R1` | No Hanging → Lifting lug-nut quantity | Numeric |
| `NO_HANGING_HANG_NOTCH_REQUIRE` | No Hanging → Hang notch required | Text flag |
| `NO_HANGING_HANG_NOTCH_REQUIR1` | No Hanging → Hang notch quantity | Numeric |

---

## Fields in DocuWare Cabinet NOT Written by the App

These fields exist in the Receiving Data cabinet but are not written by the receiving app. They are sourced from the upstream POD import or managed externally.

| DocuWare Field | Notes |
|---|---|
| `LINE` | Line number — set at import time from POD |
| `UNIQUE_NUMBER` | External line reference from DocuWare |
| `PRIMARY_KEY` | External traceability key from DocuWare |
| `DNDOCID` | DocuWare grouping reference (source POD doc ID) |
| `DNDOCIDI` | Numeric variant of DNDOCID |
| `ITEM_NAME_ON_DELIVERY_NOTE` | Line description as on delivery note — from POD |
| `QUANTITY` | Expected quantity — set at import, not updated by app |
| `OTHER` | Freeform exception field — not used by app |
| `TEXTSHOT` | System / OCR field |
| `DRAIN_HOLES` | Legacy POD field (not the app's DRAIN_HOLES_REQUIRED) |
| `VENT_HOLES` | Legacy POD field |
| `JIG_HOLES` | Legacy POD field |
| `CAVITY_VENT_HOLES` | Legacy POD field |
| `LIFTING_LUG_NUT` | Legacy POD field |
| `HANG_NOTCH` | Legacy POD field |
| `ARTICLE_OVERLAP_VENT_HOLES` | Legacy POD field (app writes mitigation text here) |
| `DWDOCID`, `DWSTOREDATETIME`, `DWMODDATETIME` | DocuWare system fields — read by app, not written |
