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

binary_path="$repo_root/backend/bin/devdbproxy"

cd "$repo_root/backend"
go build -o "$binary_path" ./cmd/devdbproxy

exec "$binary_path"