#!/bin/zsh
set -eu
bridge_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
plugin_dir="$(dirname -- "$bridge_dir")"
host_dir="${1:-$(dirname -- "$plugin_dir")/blivechat}"
cd -- "$host_dir"
exec "$host_dir/.venv/bin/python" -B "$bridge_dir/run_blivechat.py" --blivechat "$host_dir"
