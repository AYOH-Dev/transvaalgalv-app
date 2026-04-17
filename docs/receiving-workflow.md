# Receiving Workflow

## Purpose

This document maps the current Planet Press-driven receiving process into the target Transvaal Galv App workflow.

The intent is not to remove DocuWare from the process. The intent is to let DocuWare perform document capture and intelligent indexing, while the Transvaal application takes ownership of live operational receiving.

## Current Flow

1. A POD is imported and captured in DocuWare.
2. DocuWare stores the indexed line items in the `Receiving Data` cabinet.
3. Planet Press fetches the indexed record details and writes them into a SQL database as header and line rows.
4. Planet Press presents the data in the app for receipting, including defects.
5. Planet Press updates the SQL database and then updates the existing DocuWare `Receiving Data` line item.

## Target Flow

1. A POD is imported and captured in DocuWare.
2. DocuWare intelligent indexing stores the POD in the `Documents` cabinet and extracts the `PRODUCT_TABLE` line items.
3. DocuWare creates flat receiving records in the `Receiving Data` cabinet.
4. The Transvaal application imports from `Receiving Data` and creates an operational receipt snapshot in its own database.
5. Users perform receipting inside the Transvaal application against that operational snapshot.
6. The application stores all live state changes locally: quantities received, defects, holds, notes, review decisions, and audit information.
7. The application synchronizes selected receipt results back to the DocuWare `Receiving Data` cabinet.
8. Dispatch and later workflows extend the same operational record instead of creating a second client system.

## System Ownership

### What Comes From DocuWare

- POD document identifier from `Documents`
- source document metadata from `Documents`
- expected line items extracted by DocuWare from `Documents.PRODUCT_TABLE`
- flat receiving records from `Receiving Data`
- external `Receiving Data` record identifiers needed for sync-back

### What Lives In The Application Database

- authenticated users and roles
- operational receipt header snapshot
- operational receipt lines snapshot
- received quantities
- partial receipt progress
- defect and exception records
- quality hold or review state
- who received or reviewed each record
- timestamps and audit trail fields
- staged document references and archive status
- DocuWare sync queue and retry state

### What Gets Written Back To DocuWare

- receipt status
- line receipt outcome
- received quantities where required by the `Receiving Data` record model
- defect or hold summary fields when the business wants them visible in DocuWare
- review/completion state
- application reference identifiers needed for traceability

## Why The Application Still Needs A Database

DocuWare has a strong API, but the receiving app still needs its own database because the app is not just viewing indexed documents.

The app is running a transactional workflow:

- users log in and are authorized by role
- receipt progress changes over time
- one line can be partially received
- defects can be added and resolved independently
- a receipt can move through draft, received, quality hold, matched, and archived states
- sync-back to DocuWare can fail and must be retried safely

That operational state is cleaner and safer in the application database than in DocuWare alone.

## Table Responsibilities

### Existing Tables That Already Fit The Target Flow

- `app_users`: project users and roles
- `receipts`: operational receipt header
- `receipt_lines`: operational line-item projection and receiving quantities
- `receipt_exceptions`: defects, mismatches, and quality issues
- `receipt_documents`: staged or archived receipt documents
- `docuware_upload_jobs`: retryable sync and archive work

### Recommended Additions Before Full DocuWare Import And Sync

- `receipts.docuware_document_id`: source POD document id
- `receipts.docuware_record_id`: external `Receiving Data` grouping id when applicable
- `receipts.imported_at`: when the DocuWare record was imported into the app
- `receipts.last_synced_at`: last successful sync-back time
- `receipts.sync_status`: current DocuWare sync state
- `receipt_lines.docuware_record_line_id`: external `Receiving Data` line id
- `receipt_lines.last_synced_at`: line-level sync timestamp when needed
- an optional `receipt_events` or `receipt_line_events` table if a detailed operational audit log is required beyond `created_at` and `updated_at`

## API Responsibilities

### Endpoints Already Live

- `POST /auth/bootstrap-admin`
- `POST /auth/login`
- `GET /auth/me`
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{id}`
- `POST /integrations/docuware/imports`
- `GET /receipts`
- `GET /receipts/{id}`

### Endpoints To Add For The Receiving Flow

- `POST /receipts`: create a manual receipt when no DocuWare import exists
- `PATCH /receipts/{id}`: update receipt header fields and top-level status
- `POST /receipts/{id}/lines`: add or confirm receipt lines when manual capture is required
- `PATCH /receipts/{id}/lines/{lineId}`: update received quantity, condition notes, and line-level progress
- `POST /receipts/{id}/lines/{lineId}/exceptions`: record a defect or mismatch against a line
- `PATCH /receipts/{id}/exceptions/{exceptionId}`: resolve or update a defect
- `POST /receipts/{id}/documents`: stage a document upload or register a DocuWare document reference
- `POST /receipts/{id}/sync/docuware`: push updated receipt and line state back to the DocuWare `Receiving Data` cabinet
- `POST /receipts/{id}/complete`: mark the receipt complete and trigger final sync behavior

## Planet Press Replacement Boundary

In the target design, the Transvaal application replaces the part of Planet Press that currently:

- fetches the indexed receipt details
- writes operational rows into SQL
- presents the receipting workflow to users
- updates operational state as receipting progresses
- writes receipt results back into the `Receiving Data` cabinet

This does not imply redesigning the `Receiving Data` cabinet itself, especially where that cabinet also supports client BI access outside this project's scope.

DocuWare stays in the process. Planet Press is what becomes optional.

## Implementation Sequence

1. Add the DocuWare external id fields required for import and sync.
2. Build the DocuWare import endpoint or worker that reads `Receiving Data` and creates receipt headers and lines.
3. Build receipt list and receipt detail endpoints.
4. Build line receiving and defect endpoints.
5. Build `Receiving Data` sync-back logic with retry state.
6. Add the frontend once the backend contract is stable.

## Current Implementation Note

The first implemented import path accepts already-materialized `Receiving Data` rows through `POST /integrations/docuware/imports` and normalizes them into application receipts and receipt lines.

That keeps the existing DocuWare `Documents` to `Receiving Data` transformation untouched while giving the application a stable ingestion boundary.