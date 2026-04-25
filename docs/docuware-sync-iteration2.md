# DocuWare Sync Iteration 2 — Defects & Mitigations

## Overview

Iteration 2 extends the sync write-back to include defect detection results and mitigation records. All data is derived from the `condition_notes` field (wizard JSON payload) that was already being captured in iteration 1.

## Architecture

No new tables or migrations needed. Iteration 2 only extends the existing `docuware/sync.go` logic:

- **extractDefectFields()** — parses `condition_notes` JSON → DocuWare field updates
- **BuildFieldUpdates()** — now calls extractDefectFields() and appends defect fields to the response

## Data Mapping

### Defect Flags

All 17 defect types map to Yes/No fields on the Receiving Data cabinet:

| Wizard Key | DocuWare Field | Type |
|---|---|---|
| `paint` | `PAINT` | Yes/No |
| `damaged` | `DAMAGED` | Yes/No |
| `rust` | `RUST` | Yes/No |
| `delamination` | `DELAMINATION` | Yes/No |
| `nonConformingPreGalv` | `NON_CONFORMING_PRE_GALV` | Yes/No |
| `enclosedCavity` | `ENCLOSED_CAVITY` | Yes/No |
| `threadedArticle` | `THREADED_ARTICLE` | Yes/No |
| `burr` | `BURR` | Yes/No |
| `pinHoles` | `PIN_HOLES` | Yes/No |
| `weldSplatter` | `WELD_SPLATTER` | Yes/No |
| `weldingFlux` | `WELDING_FLUX` | Yes/No |
| `continuousWeld` | `CONTINUOUS_WELD` | Yes/No |
| `articleOverlapped` | `ARTICLE_OVERLAPPED` | Yes/No |
| `possibleDistortion` | `POSSIBLE_DISTORTION` | Yes/No |
| `oilGreaseDiesel` | `OIL_GREASE_DIESEL` | Yes/No |
| `sharpEdges` | `SHARP_EDGES` | Yes/No |
| `holesInadequate` | `HOLES_INADEQUATE` | Yes/No |
| `noHangingMethod` | `NO_HANGING_METHOD` | Yes/No |

**Overall flag**:
- `DEFECT_DETECTED` ← set to "Yes" if ANY of the above flags are true; otherwise "No"

### Mitigations

Mitigation selections are comma-joined and written to single text fields:

| Wizard Key | DocuWare Field |
|---|---|
| `paintMitigation` | `PAINT_MITIGATION` |
| `damagedMitigation` | `DAMAGE_MITIGATION` |
| `rustMitigation` | `RUST_MITIGATION` |
| `delaminationMitigation` | `DELAMINATION_MITIGATION` |
| `nonConformingPreGalvMitigation` | `NON_CONFORMING_PRE_GALV_MITIG` |
| `threadedArticleMitigation` | `THREADED_ARTICLE_MITIGATION` |
| `enclosedCavityMitigation` | `ENCLOSED_CAVITY_HOLES_REQUIRE` |

Example: if `paintMitigation: ["Sanding", "Repainting"]`, DocuWare receives `PAINT_MITIGATION: "Sanding, Repainting"`.

### Hole Quantities

If the wizard captures hole counts, they are written as numeric strings:

| Wizard Key | DocuWare Field |
|---|---|
| `drainHolesQty` | `DRAIN_HOLES` |
| `ventHolesQty` | `VENT_HOLES` |
| `jigHolesQty` | `JIG_HOLES` |
| `cavityVentHolesQty` | `CAVITY_VENT_HOLES` |

These are optional and only written if present in the JSON.

### Additional Comments

If the wizard includes a separate `additionalComments` field, it is written to `ADDITIONAL_COMMENTS` (separate from the main `COMMENTS` field).

## condition_notes JSON Schema

The wizard payload stored in `receipt_lines.condition_notes` is expected to have this shape:

```json
{
  "defectDetected": "Yes|No",
  
  // Defect flags
  "paint": true,
  "damaged": false,
  "rust": true,
  "delamination": false,
  "nonConformingPreGalv": false,
  "enclosedCavity": true,
  "threadedArticle": false,
  "burr": false,
  "pinHoles": false,
  "weldSplatter": false,
  "weldingFlux": false,
  "continuousWeld": false,
  "articleOverlapped": false,
  "possibleDistortion": false,
  "oilGreaseDiesel": false,
  "sharpEdges": false,
  "holesInadequate": false,
  "noHangingMethod": false,
  
  // Mitigation selections (arrays of strings)
  "paintMitigation": ["Sanding", "Repainting"],
  "damagedMitigation": [],
  "rustMitigation": ["Coating"],
  "delaminationMitigation": [],
  "nonConformingPreGalvMitigation": [],
  "threadedArticleMitigation": [],
  "enclosedCavityMitigation": ["Drain holes added"],
  
  // Optional hole quantities
  "drainHolesQty": 2,
  "ventHolesQty": 4,
  "jigHolesQty": 0,
  "cavityVentHolesQty": 1,
  
  // Optional additional comments
  "additionalComments": "Rust observed on welds; customer approved mitigation."
}
```

## Implementation Details

### Field Count

Iteration 2 adds up to **24 additional fields** to the sync payload:
- 1 overall defect flag
- 17 defect Yes/No fields
- 7 mitigation comma-joined strings (written only if non-empty)
- 4 optional hole quantities (written only if present)
- 1 optional additional comments field (written only if non-empty)

Total iteration 1+2: **38+ fields per line sync**.

### JSON Parsing

The `extractDefectFields()` function:
1. Deserializes `condition_notes` as `map[string]interface{}`
2. Iterates defect keys and writes "Yes" for true, skips false
3. Collects non-empty mitigation arrays as comma-joined strings
4. Converts hole quantities to integer strings
5. Returns all as `[]FieldUpdate` to be appended to iteration 1 fields

Missing or null fields are silently skipped (no DocuWare field written for them).

### Error Handling

If `condition_notes` is:
- Empty or whitespace → no defect fields written
- Invalid JSON → parsing fails silently, returns empty array
- Missing expected keys → treated as absent/false (graceful degradation)

This ensures the sync always completes the iteration 1 fields even if defect data is malformed or missing.

## Testing

### Manual Test Flow

1. Mark a line as received (same as iteration 1)
2. Expand the Defects & Discrepancies accordion
3. Select some defect flags and mitigations
4. Submit the defect wizard → `condition_notes` JSON is saved
5. Wait for sync poll cycle or trigger manually: `POST /receipts/{id}/sync/docuware`
6. Query DocuWare Receiving Data cabinet
7. Verify defect flags are present (e.g., `PAINT=Yes`, `RUST=Yes`)
8. Verify mitigations are comma-joined (e.g., `PAINT_MITIGATION="Sanding, Repainting"`)
9. Verify `DEFECT_DETECTED=Yes` if any flag was set

### SQL Check

```sql
SELECT
  id,
  docuware_record_line_id,
  condition_notes,
  last_synced_at,
  docuware_sync_error
FROM receipt_lines
WHERE condition_notes != ''
ORDER BY last_synced_at DESC
LIMIT 10;
```

Then visually inspect `condition_notes` JSON and cross-reference with DocuWare cabinet.

### Debugging

Enable detailed logging in the worker:
```go
// In worker.syncItem(), after successful update:
w.logger.Printf("sync completed: line_id=%s, fields=%d, defects=%d",
  item.LineID, result.FieldCount, countDefectFields(fields))
```

Count defect fields in the result to ensure iteration 2 fields were actually included.

## Backward Compatibility

Iteration 2 is fully backward compatible:

- **Existing lines without defects**: `condition_notes` is empty or missing → extractDefectFields() returns `[]`, iteration 1 fields still written
- **Existing syncs**: If a line was synced in iteration 1 (before defects were added), re-syncing it after defects are captured will add the defect fields on the next sync
- **Partial defect data**: If the wizard only captured some defects, missing ones are skipped (not written as "No")

## Operational Notes

### Resync After Defect Changes

If a user edits the defect wizard after a line was already synced:
1. The `condition_notes` column is updated
2. User can trigger a manual resync: `POST /receipts/{id}/sync/docuware`
3. The updated defect fields are sent to DocuWare, overwriting previous values

### Mitigation Data Loss

If a mitigation list is cleared (e.g., user removes all items), the field is not written to DocuWare (empty lists are skipped). To explicitly clear a mitigation in DocuWare, the field must be set to an empty string via the cabinet UI or a separate API call.

### Future Extensions

Possible iteration 3+ work:
- Photo evidence fields (currently handled separately via receipt_documents)
- Structured hole requirement tables (if wizard expands to capture required vs. actual)
- Defect follow-up workflow (rework status, completion date, sign-off)
- BI reporting on defect trends (via DocuWare cabinet queries)

## Files Modified

From iteration 1:
- `docuware/sync.go` — added extractDefectFields(), extended SyncableReceiptLine struct, updated BuildFieldUpdates()
- `docuware/worker.go` — fetch condition_notes in DB query, pass to syncItem()

No new migrations or tables.

## References

- [Iteration 1 Implementation](docuware-sync-implementation.md)
- [Field Mapping](docuware-receiving-data-cabinet.md)
- [Receiving Workflow](receiving-workflow.md)
