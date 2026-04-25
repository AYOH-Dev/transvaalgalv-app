# DocuWare Sync Write-Back Implementation

## Overview

Iteration 1 of the DocuWare sync-back system writes receipt line outcomes (status, process, packaging, storage, quantities, etc.) back to the Receiving Data cabinet per-line. Defects and mitigations are deferred to iteration 2.

## Architecture

### Components

1. **docuware/client.go** — OAuth token management + PUT /Fields endpoint wrapper
2. **docuware/sync.go** — Field mapping logic (app model → DocuWare field updates)
3. **docuware/worker.go** — Async queue worker with exponential backoff retry
4. **migrations/006_docuware_sync_queue.sql** — Queue table + sync state columns on receipt_lines
5. **receiving/service.go** — Integration point: enqueue sync on line update
6. **httpapi/receipts.go** — POST /receipts/{id}/sync/docuware for manual trigger
7. **cmd/api/main.go** — Worker initialization + background loop

### Data Flow

```
User marks line as "received" via PATCH /receipts/{id}/lines/{lineId}
  ↓
receiving.UpdateReceiptLine() updates DB
  ↓
If receiving_status is set, enqueue sync to docuware_sync_queue
  ↓
Worker polls docuware_sync_queue every 30s (configurable)
  ↓
For each pending item:
  - Mark as in_progress
  - Fetch line + receipt header from DB
  - Build field update payload (14 fields iteration 1)
  - PUT to DocuWare /Platform/FileCabinets/{cabinetId}/Documents/{lineId}/Fields
  - On success: mark queue entry completed, update receipt_lines.last_synced_at
  - On retryable error: schedule next retry with exponential backoff (2^attempt minutes)
  - On non-retryable or max attempts: mark failed, log error to receipt_lines.docuware_sync_error
```

## Field Mapping (Iteration 1)

### Header Fields (repeated on every line)
- `COMPANY` ← `receipts.customer_name`
- `FABRICATOR` ← `receipts.supplier_name`
- `DELIVERY_NOTE` ← `receipts.delivery_note_number`
- `ORDER_NUMBER` ← `receipts.purchase_order_number`
- `WEIGHBRIDGE_TICKET_NUMBER` ← `receipts.weighbridge_ticket_number`
- `VEHICLE_REGISTRATION` ← `receipts.vehicle_registration`
- `JOB_NUMBER` ← `receipts.job_number`

### Line Outcome Fields
- `ITEM_TYPE` ← `receipt_lines.item_type`
- `PROCESS` ← `receipt_lines.process`
- `PACKAGING_METHOD` ← `receipt_lines.packaging_method`
- `INTERNAL_DESCRIPTION` ← `receipt_lines.internal_description`
- `REQUIRED_GALV_THICKNESS` ← `receipt_lines.required_galv_thickness`
- `QUANTITY_RECEIVED` ← `receipt_lines.received_quantity` (numeric → string)
- `QUANTITY_DISCREPANCY` ← `receipt_lines.quantity_discrepancy`
- `DISCREPANCY` ← `receipt_lines.discrepancy`
- `RECEIVING_STATUS` ← `receipt_lines.receiving_status` (humanized: "draft" → "Draft")
- `STORED_IN` ← `receipt_lines.stored_in`
- `BAY` ← `receipt_lines.bay`
- `ACCESSORIES` ← `receipt_lines.accessories`
- `COMMENTS` ← `receipt_lines.comments`

### Deferred (Iteration 2)
- Defect flags: PAINT, DAMAGED, RUST, DELAMINATION, NON_CONFORMING_PRE_GALV, ENCLOSED_CAVITY, THREADED_ARTICLE, etc.
- Mitigation strings: PAINT_MITIGATION, DAMAGE_MITIGATION, RUST_MITIGATION, etc.
- Hole quantity fields

## Configuration

### Environment Variables

```
# DocuWare OAuth credentials (for sync write-back)
DOCUWARE_USERNAME=APADMIN
DOCUWARE_PASSWORD=AYOH.123!

# DocuWare inbound push credentials (existing, for imports)
DOCUWARE_PUSH_USERNAME=...
DOCUWARE_PUSH_PASSWORD=...

# Sync worker tuning
DOCUWARE_SYNC_INTERVAL=30s           # Poll interval (default 30s)
DOCUWARE_SYNC_MAX_WORKERS=3          # Parallel syncs per poll cycle (default 3)

# Cabinet details (existing, used for both imports and sync)
DOCUWARE_BASE_URL=https://transgalv.docuware.cloud
DOCUWARE_FILE_CABINET_ID=51b2227c-4d38-4e2e-a583-f5a012b75496
```

## Queue Management

### Status Values
- `pending` — ready to sync or awaiting retry
- `in_progress` — currently syncing
- `completed` — sync succeeded
- `failed` — sync failed permanently (max attempts or non-retryable error)

### Retry Logic
- **Max attempts**: 5 (configurable in code)
- **Backoff**: exponential, 2^attempt minutes (1, 2, 4, 8, 16 min)
- **Retryable errors**: HTTP 429/500-504, timeouts, connection errors
- **Non-retryable**: HTTP 400/401/403/404, invalid line ID, missing data

### Monitoring

Query pending syncs:
```sql
SELECT id, receipt_line_id, status, attempt_count, last_error, next_retry_at
FROM docuware_sync_queue
WHERE status IN ('pending', 'in_progress')
ORDER BY created_at ASC;
```

Query failed syncs:
```sql
SELECT id, receipt_line_id, last_error, attempt_count
FROM docuware_sync_queue
WHERE status = 'failed'
ORDER BY updated_at DESC
LIMIT 50;
```

Check line sync history:
```sql
SELECT id, docuware_record_line_id, last_synced_at, docuware_sync_error
FROM receipt_lines
WHERE docuware_sync_error != ''
ORDER BY last_synced_at DESC;
```

## API Endpoints

### Manual Sync Trigger (Testing/Recovery)
```
POST /receipts/{receiptId}/sync/docuware
Authorization: Bearer {token}
Content-Type: application/json

{
  "line_id": "uuid-of-line"
}

Response: 202 Accepted
{
  "status": "queued",
  "message": "Line sync queued for DocuWare"
}
```

## Known Limitations & Future Work

1. **Defects**: Iteration 2 will map condition_notes wizard payload → defect flags + mitigations
2. **ADDITIONAL_COMMENTS**: Currently merged into COMMENTS; future iteration may split
3. **Photo uploads**: Separate from field sync; handled by existing receipt_documents flow
4. **Rate limiting**: No client-side rate limiting; DocuWare rate limits trigger retries
5. **Token refresh**: Token expiry handled transparently; no manual intervention needed
6. **Sync status visibility**: Frontend could poll receipt_lines.last_synced_at + docuware_sync_error for UI feedback

## Testing Checklist

- [ ] Apply migration 006_docuware_sync_queue.sql to dev DB
- [ ] Set DOCUWARE_USERNAME, DOCUWARE_PASSWORD in .env.dev
- [ ] Start API with sync worker enabled (`log.Printf` on startup)
- [ ] PATCH /receipts/{id}/lines/{lineId} with receiving_status: "received"
- [ ] Verify docuware_sync_queue has a pending entry
- [ ] Wait for next poll cycle (30s default) or POST /receipts/{id}/sync/docuware manually
- [ ] Query receipt_lines.last_synced_at to confirm sync completed
- [ ] Check DocuWare Receiving Data cabinet to verify fields updated
- [ ] Test retry logic by blocking DocuWare and verifying exponential backoff
- [ ] Verify non-retryable errors (e.g., invalid line ID) mark as failed, don't retry

## References

- [DocuWare Field Mapping](docuware-receiving-data-cabinet.md)
- [Receiving Workflow](receiving-workflow.md)
- [Cabinet Schema](Receiving_Data_Fileds.txt)
