#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"

export APP_DB_NAME="${APP_DB_NAME:-transvaalgalv_app_db_dev}"
export APP_DB_USER="${APP_DB_USER:-transvaal_user_dev}"

exec "$script_dir/provision-db.sh"