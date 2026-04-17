#!/usr/bin/env bash
set -euo pipefail

db_container="${DB_CONTAINER:-gateway-postgres-1}"
db_superuser="${DB_SUPERUSER:-postgres}"
app_db_name="${APP_DB_NAME:-transvaalgalv_app_db}"
app_db_user="${APP_DB_USER:-transvaal_user}"
app_db_password="${APP_DB_PASSWORD:-}"
migration_file="${MIGRATION_FILE:-migrations/001_init_schema.sql}"

if [[ -z "$app_db_password" ]]; then
	echo "APP_DB_PASSWORD is required. This is the password for the Postgres role ${app_db_user}, not your sudo or login password." >&2
	exit 1
fi

if [[ ${#app_db_password} -lt 32 ]]; then
	echo "APP_DB_PASSWORD must be at least 32 characters; got ${#app_db_password}. This is the password for the Postgres role ${app_db_user}, not your sudo or login password." >&2
	exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
migration_path="${repo_root}/${migration_file}"

if [[ ! -f "$migration_path" ]]; then
	echo "Migration file not found: $migration_path" >&2
	exit 1
fi

echo "Provisioning ${app_db_name} in ${db_container}..."
sudo docker exec -i -u "$db_superuser" "$db_container" psql -U "$db_superuser" -d postgres -v ON_ERROR_STOP=1 -v app_db="$app_db_name" -v app_user="$app_db_user" -v app_password="$app_db_password" <<'SQL'
SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'app_user', :'app_password')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'app_db', :'app_user')
\gexec
SQL

echo "Ensuring schema access for ${app_db_user}..."
sudo docker exec -i -u "$db_superuser" "$db_container" psql -U "$db_superuser" -d "$app_db_name" -v ON_ERROR_STOP=1 -v owner_role="$db_superuser" -v app_user="$app_db_user" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user')
\gexec

SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO %I', :'owner_role', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO %I', :'owner_role', :'app_user')
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO %I', :'owner_role', :'app_user')
\gexec
SQL

schema_exists="$(sudo docker exec -i -u "$db_superuser" "$db_container" psql -U "$db_superuser" -d "$app_db_name" -tA -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_users');")"

if [[ "$schema_exists" == "t" ]]; then
	echo "Schema already present in ${app_db_name}; skipping ${migration_file}."
else
	echo "Applying ${migration_file}..."
	sudo docker exec -i -u "$db_superuser" "$db_container" psql -U "$db_superuser" -d "$app_db_name" -v ON_ERROR_STOP=1 < "$migration_path"
fi

echo "Ensuring table, sequence, and enum ownership for ${app_db_user}..."
sudo docker exec -i -u "$db_superuser" "$db_container" psql -U "$db_superuser" -d "$app_db_name" -v ON_ERROR_STOP=1 -v app_user="$app_db_user" <<'SQL'
SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO %I', :'app_user')
\gexec

SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'app_user')
FROM pg_tables
WHERE schemaname = 'public'
\gexec

SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', sequence_schema, sequence_name, :'app_user')
FROM information_schema.sequences
WHERE sequence_schema = 'public'
\gexec

SELECT format('GRANT USAGE ON TYPE %I.%I TO %I', n.nspname, t.typname, :'app_user')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e'
\gexec

SELECT format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, :'app_user')
FROM pg_type t
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public' AND t.typtype = 'e'
\gexec
SQL

echo "Provisioning complete for ${app_db_name}."
echo "PostgreSQL on 10.100.0.1:5432 currently refuses TLS, so application startup still requires PostgreSQL TLS to be enabled or a TLS-capable DB proxy in front of that endpoint."