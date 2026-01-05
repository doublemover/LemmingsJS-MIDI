#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./release_mcpb.sh <version> <mcpb_path>
# Example:
#   ./release_mcpb.sh 1.0.0 dist/your-server.mcpb
#
# Assumes:
# - You have already updated manifest.json "version" to match <version>
# - You have installed the MCPB CLI (mcpb)
# - You will upload the resulting .mcpb as a GitHub Release asset

VERSION="${1:-}"
OUTFILE="${2:-}"

if [[ -z "$VERSION" || -z "$OUTFILE" ]]; then
  echo "Usage: $0 <version> <mcpb_path>"
  exit 1
fi

echo "Packing MCPB bundle -> ${OUTFILE}"
mcpb pack "${OUTFILE}"

echo ""
echo "Computing SHA-256..."
if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "${OUTFILE}" | awk '{print $1}')"
elif command -v openssl >/dev/null 2>&1; then
  SHA256="$(openssl dgst -sha256 "${OUTFILE}" | awk '{print $2}')"
else
  echo "Neither shasum nor openssl found. Install one to compute sha256."
  exit 2
fi

echo "SHA256: ${SHA256}"
echo ""
echo "Next steps:"
echo "1) Create a GitHub Release tagged v${VERSION} and upload ${OUTFILE} as an asset."
echo "2) Set your server.json package entry to:"
cat <<EOF

{
  "registryType": "mcpb",
  "identifier": "https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO/releases/download/v${VERSION}/$(basename "${OUTFILE}")",
  "fileSha256": "${SHA256}",
  "transport": { "type": "stdio" }
}

EOF
