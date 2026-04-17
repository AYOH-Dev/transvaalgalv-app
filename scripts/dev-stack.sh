#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="${ENV_FILE:-}"

if [[ -z "$env_file" ]]; then
	if [[ -f "$repo_root/.env.dev" ]]; then
		env_file="$repo_root/.env.dev"
	elif [[ -f "$repo_root/.env" ]]; then
		env_file="$repo_root/.env"
	fi
fi

if [[ -n "$env_file" && -f "$env_file" ]]; then
	set -a
	. "$env_file"
	set +a
fi

if [[ -z "${TRANSVAAL_DATABASE_PROXY_URL:-}" ]]; then
	echo "TRANSVAAL_DATABASE_PROXY_URL is required for dev-stack.sh." >&2
	exit 1
fi

listen_addr="${DEV_DB_PROXY_LISTEN_ADDR:-127.0.0.1:6543}"
listen_host="${listen_addr%:*}"
listen_port="${listen_addr##*:}"
proxy_started=0

is_proxy_ready() {
	(exec 3<>"/dev/tcp/${listen_host}/${listen_port}") >/dev/null 2>&1
}

if is_proxy_ready; then
	echo "Using existing dev db proxy on ${listen_addr}."
else
	"$repo_root/scripts/dev-db-proxy.sh" &
	proxy_pid=$!
	proxy_started=1

	for _ in $(seq 1 50); do
		if is_proxy_ready; then
			break
		fi
		sleep 0.2
	done

	if ! is_proxy_ready; then
		echo "dev db proxy did not become ready on ${listen_addr}." >&2
		exit 1
	fi
fi

cleanup() {
	if [[ "$proxy_started" == "1" ]]; then
		kill "$proxy_pid" 2>/dev/null || true
		wait "$proxy_pid" 2>/dev/null || true
	fi
}
trap cleanup EXIT INT TERM

export TRANSVAAL_DATABASE_URL="$TRANSVAAL_DATABASE_PROXY_URL"
cd "$repo_root/backend"
go run ./cmd/api