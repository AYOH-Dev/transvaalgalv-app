# Transvaal Galv App

Transvaal Galv App is the standalone operations application for Transvaal Galvanisers.

Phase 1 focuses on receiving. Later phases can extend the same application into dispatch and other operational workflows without creating a second client repo.

This repository is the operational system of record for application workflows. DocuWare captures and indexes incoming PODs, while the application database stores live receiving state and synchronizes selected outcomes back to DocuWare.

## Current Scope

- Backend-first delivery
- Phase 1 receiving domain delivery
- Public portal behind login
- Project-specific users and roles
- Receipt capture, line capture, document attachment, and exception handling
- DocuWare import and sync integration around the receiving workflow

See `docs/receiving-workflow.md` for the target receiving flow and system ownership model.

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

1. Copy `.env.example` to `.env` for the main application database, or copy `.env.dev.example` to `.env.dev` for the dedicated development database.
2. Provision the matching PostgreSQL database on the shared PostgreSQL server at `10.100.0.1:5432`.
3. For direct database TLS, run the backend:

```bash
./scripts/dev-backend.sh
```

4. If PostgreSQL TLS is not enabled yet, use the local development TLS shim instead:

```bash
./scripts/dev-stack.sh
```

## Database Setup

Preferred on the gateway host:

```bash
APP_DB_PASSWORD='<strong-password>' ./scripts/provision-db.sh
APP_DB_PASSWORD='<strong-password>' ./scripts/provision-dev-db.sh
```

`APP_DB_PASSWORD` is the password that will be assigned to the PostgreSQL role `transvaal_user`. It is not your Linux login password or your `sudo` password.

The first command provisions `transvaalgalv_app_db` with `transvaal_user`. The second provisions `transvaalgalv_app_db_dev` with `transvaal_user_dev`.

The scripts use `sudo docker exec` against `gateway-postgres-1`, create or update the application role, create the database when missing, apply `migrations/001_init_schema.sql` the first time the schema is absent, and then transfer/grant schema object access to the application role.

Create the application role and database on `10.100.0.1:5432` with a PostgreSQL admin account:

```bash
psql "host=10.100.0.1 port=5432 dbname=postgres user=<admin-user> sslmode=require"
```

Then run:

```sql
CREATE ROLE transvaal_user WITH LOGIN PASSWORD '<strong-password>';
CREATE DATABASE transvaalgalv_app_db OWNER transvaal_user;
GRANT ALL PRIVILEGES ON DATABASE transvaalgalv_app_db TO transvaal_user;
```

Apply the initial schema:

```bash
psql "postgres://transvaal_user:<strong-password>@10.100.0.1:5432/transvaalgalv_app_db?sslmode=require" -f migrations/001_init_schema.sql
```

Set the application connection string in `.env`:

```env
TRANSVAAL_DATABASE_URL=postgres://transvaal_user:<strong-password>@10.100.0.1:5432/transvaalgalv_app_db?sslmode=require
```

For the dedicated development environment, copy `.env.dev.example` to `.env.dev` and use:

```env
TRANSVAAL_DATABASE_URL=postgres://transvaal_user_dev:<strong-password>@10.100.0.1:5432/transvaalgalv_app_db_dev?sslmode=require
TRANSVAAL_DATABASE_PROXY_URL=postgres://transvaal_user_dev:<strong-password>@127.0.0.1:6543/transvaalgalv_app_db_dev?sslmode=require
DEV_DB_PROXY_TARGET_ADDR=10.100.0.1:5432
DEV_DB_PROXY_LISTEN_ADDR=127.0.0.1:6543
```

Current infrastructure note:

- `10.100.0.1:5432` is reachable, but it currently refuses TLS handshakes.
- Provisioning can still be done from inside the PostgreSQL container with `./scripts/provision-db.sh`.
- The application itself will not start against that TCP endpoint until PostgreSQL TLS is enabled or a TLS-capable proxy is placed in front of it, because the backend enforces `sslmode=require`.
- `./scripts/dev-stack.sh` provides a dev-only local TLS shim so work can continue before the shared PostgreSQL service has native TLS.

The service exposes:

- `GET /health`
- `GET /ready`
- `POST /auth/bootstrap-admin`
- `POST /auth/login`
- `GET /auth/me`
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/{id}`

## Initial Auth Flow

1. Set `JWT_SECRET` in `.env`.
2. Set `BOOTSTRAP_ADMIN_TOKEN` in `.env`.
3. Start the backend.
4. Create the first admin with `POST /auth/bootstrap-admin` and the `X-Bootstrap-Token` header.
5. Log in through `POST /auth/login`.
6. Use the returned bearer token for `/auth/me` and `/admin/users` requests.

## Current Deliverables In This Baseline

- Repository bootstrap files
- Minimal Go API server with secure HTTP defaults
- Database-backed authentication and project-user management
- Initial receiving-first schema migration
- Documentation for architecture, integrations, and deployment baseline
- CI for backend build and tests

## Next Build Steps

1. Implement receipt capture and listing endpoints.
2. Add staged document upload and DocuWare retry handling.
3. Add dispatch as the next domain once the receiving contract is stable.
4. Build the frontend after the backend contract is stable.