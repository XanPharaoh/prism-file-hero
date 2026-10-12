#!/usr/bin/env bash
# Reproducible `soffice` shim for processing/libreofficeProvider.ts.
# The provider spawn()s `soffice` with ABSOLUTE host temp paths. This shim runs the containerized
# engine (image `prism-lo`) and bind-mounts the throwaway temp dir at the IDENTICAL host path so the
# argv paths resolve inside the container unchanged. It runs as the HOST uid (so the provider's own
# cleanup can delete generated files) with HOME pointed at that dir. Committed for reproducibility;
# scripts/run-conversions.mjs installs it onto PATH as `soffice`.
set -euo pipefail
args=("$@")
if printf '%s\0' "${args[@]}" | grep -qz -- '--convert-to'; then
  input="${args[-1]}"
  dir="$(dirname "$input")"
  exec docker run --rm --user "$(id -u):$(id -g)" -e HOME="$dir" -v "$dir:$dir" prism-lo "${args[@]}"
else
  exec docker run --rm prism-lo "${args[@]}"
fi
