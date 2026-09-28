#!/usr/bin/env bash
# Uploads a release to a Cloudflare R2 bucket (S3 compatible) that the apps
# read as a generic update feed (REVIVE_UPDATE_URL = the bucket's public URL).
# The installers go up first and the feed files (*.yml) last, so no app ever
# sees a feed pointing at a file that isn't there yet.
#
# Needs: R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (an R2 API token),
# optional R2_PREFIX (a folder in the bucket).
set -euo pipefail
DIR="${1:?release directory}"
ENDPOINT="https://${R2_ACCOUNT_ID:?}.r2.cloudflarestorage.com"
DEST="s3://${R2_BUCKET:?}/${R2_PREFIX:-}"
export AWS_DEFAULT_REGION=auto
for f in "$DIR"/*.dmg "$DIR"/*.zip "$DIR"/*.blockmap; do
  [[ -e "$f" ]] && aws s3 cp "$f" "$DEST$(basename "$f")" --endpoint-url "$ENDPOINT" --cache-control "public, max-age=31536000, immutable"
done
for f in "$DIR"/*.yml; do
  [[ "$(basename "$f")" == builder-debug.yml ]] && continue
  aws s3 cp "$f" "$DEST$(basename "$f")" --endpoint-url "$ENDPOINT" --cache-control "no-cache" --content-type "text/yaml"
done
