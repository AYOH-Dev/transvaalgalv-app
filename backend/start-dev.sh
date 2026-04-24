#!/usr/bin/env bash
set -a
source /opt/projects/transvaalgalv-app/.env.dev
TRANSVAAL_DATABASE_URL="postgres://transvaal_user_dev:TransvaalDevDbPwdSecurePass123456789Later!@127.0.0.1:6543/transvaalgalv_app_db_dev?sslmode=require"
set +a
exec /opt/projects/transvaalgalv-app/backend/bin/api
