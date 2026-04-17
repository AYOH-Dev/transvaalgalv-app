# Transvaal Galv App

Transvaal Galv App is the standalone operations application for Transvaal Galvanisers.

Phase 1 focuses on receiving. Later phases can extend the same application into dispatch and other operational workflows without creating a second client repo.

This repository is the operational system of record for application workflows. DocuWare is treated as the document archive and reference layer, not the primary application datastore.

## Current Scope

- Backend-first delivery
- Phase 1 receiving domain delivery
- Public portal behind login
- Project-specific users and roles
- Receipt capture, line capture, document attachment, and exception handling
- DocuWare archive integration through staged upload and retry

## Repository Rules

- GitHub home: `AYOH-Dev/transvaalgalv-app`
- Intended server checkout path: `/opt/projects/transvaalgalv-app`
- Primary database: `transvaalgalv_app_db`
- Public host: `transvaal.ayai.live`

## Layout

```text
.
├── .github/
├── backend/
├── deploy/
├── docs/
├── frontend/
├── migrations/
├── scripts/
└── tests/
```

## Local Backend Run

1. Copy `.env.example` to `.env` and fill in local values.
2. Start a PostgreSQL database for `transvaalgalv_app_db`.
3. Run the backend:

```bash
cd backend
go run ./cmd/api
```

The service exposes:

- `GET /health`
- `GET /ready`

## Current Deliverables In This Baseline

- Repository bootstrap files
- Minimal Go API server with secure HTTP defaults
- Initial receiving-first schema migration
- Documentation for architecture, integrations, and deployment baseline
- CI for backend build and tests

## Next Build Steps

1. Add authentication and project user management.
2. Implement receipt capture and listing endpoints.
3. Add staged document upload and DocuWare retry handling.
4. Add dispatch as the next domain once the receiving contract is stable.
5. Build the frontend after the backend contract is stable.