# Transvaal Galv App Guidelines

## Architecture

- This repository is a standalone client project and must not depend on code from the legacy `gateway` repository.
- The operational source of truth is the Transvaal application database.
- DocuWare is the archive and reference layer, not the transactional datastore.
- Phase 1 is receiving. Later phases can add dispatch and adjacent operational workflows in the same repo.
- Backend delivery comes before frontend delivery.

## Security

- Use parameterized SQL only.
- Require `sslmode=require` for PostgreSQL connection strings.
- Do not hardcode secrets, passwords, tokens, or API keys.
- Keep public endpoints limited to operational health checks unless there is an explicit approved reason.

## Conventions

- Keep the project team full-stack by default.
- Prefer small, explicit internal packages under `backend/internal`.
- Keep docs current when the architecture or integration boundaries change.

## Build And Test

- Backend run command: `go run ./cmd/api` from `backend/`
- Backend test command: `go test ./...` from `backend/`