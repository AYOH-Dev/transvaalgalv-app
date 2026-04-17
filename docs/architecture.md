# Architecture

## Purpose

Transvaal Galv App manages operational workflows for Transvaal Galvanisers.

Phase 1 of the application focuses on receiving. Later phases can add dispatch and adjacent operational workflows inside the same standalone project.

The application tracks receipts, receipt lines, receipt exceptions, and supporting documents. It is designed as a standalone project with its own database, release cycle, and deployment path.

## Core Decisions

1. The application database is the operational system of record.
2. DocuWare is used as the archive and document-reference layer.
3. The first delivery phase is backend-first to stabilize the receiving workflow and integration contract.
4. Dispatch should be added as the next domain instead of creating a second client repository.
5. The public portal remains behind login.
6. The repository must remain isolated from legacy `gateway` code.

## Main Components

- `backend/cmd/api`: API entrypoint
- `backend/internal/config`: environment configuration and validation
- `backend/internal/httpapi`: HTTP server and operational endpoints
- `backend/internal/receiving`: receiving domain models and service layer
- `backend/internal/dispatch`: future dispatch domain models and service layer
- `migrations/`: database schema evolution
- `docs/`: project and integration documentation

## Initial Domain Model

- `app_users`: project-specific users and roles
- `receipts`: receipt headers
- `receipt_lines`: received line items
- `receipt_documents`: uploaded and archived documents
- `receipt_exceptions`: quantity, quality, or reference issues
- `docuware_upload_jobs`: staged upload and retry state

## Delivery Sequence

1. Establish the standalone repo baseline.
2. Implement authentication and project users.
3. Implement receipt capture and retrieval.
4. Implement document upload plus DocuWare sync.
5. Implement the dispatch domain.
6. Add the frontend after the backend API is stable.