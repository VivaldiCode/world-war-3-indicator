#!/usr/bin/env bash
# Build → tag → push the ww3-indicator image to a private registry.
#
# Usage:
#   WW3_REGISTRY=registry.example.com bin/deploy.sh           # :latest + :<sha>
#   WW3_REGISTRY=registry.example.com bin/deploy.sh v0.2.0    # also :v0.2.0
#
# Required env:
#   WW3_REGISTRY   hostname[:port] (and optionally /namespace) of your registry
#
# Optional env:
#   WW3_IMAGE_NAME image name within the registry (default: ww3-indicator)
#   WW3_PLATFORM   target platform for the build (default: linux/amd64)
#
# Notes:
#   - If your registry serves HTTP (no TLS), declare it as an insecure
#     registry on every Docker daemon that needs to push or pull it:
#       /etc/docker/daemon.json:  { "insecure-registries": ["host:port"] }
#       sudo systemctl restart docker
#   - If your registry requires auth: `docker login <host>` first.

set -euo pipefail

REGISTRY="${WW3_REGISTRY:-}"
if [[ -z "$REGISTRY" ]]; then
  echo "error: WW3_REGISTRY is required (e.g. WW3_REGISTRY=registry.example.com bin/deploy.sh)" >&2
  exit 2
fi

IMAGE="${WW3_IMAGE_NAME:-ww3-indicator}"
PLATFORM="${WW3_PLATFORM:-linux/amd64}"
EXTRA_TAG="${1:-}"

SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  SHA="${SHA}-dirty"
fi

REPO="${REGISTRY%/}/${IMAGE}"
TAGS=("latest" "${SHA}")
if [[ -n "${EXTRA_TAG}" ]]; then
  TAGS+=("${EXTRA_TAG}")
fi

echo "==> Building ${REPO} for ${PLATFORM} (sha=${SHA})"
docker build --platform="${PLATFORM}" -t "${REPO}:${SHA}" .

for t in "${TAGS[@]}"; do
  if [[ "$t" != "${SHA}" ]]; then
    docker tag "${REPO}:${SHA}" "${REPO}:${t}"
  fi
done

for t in "${TAGS[@]}"; do
  echo "==> Pushing ${REPO}:${t}"
  docker push "${REPO}:${t}"
done

echo
echo "==> Done. Images pushed:"
for t in "${TAGS[@]}"; do
  echo "    ${REPO}:${t}"
done
