#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="asia-south1"
SERVICE_NAME="meroshare"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Set GCP_PROJECT_ID environment variable first."
  echo "  export GCP_PROJECT_ID=your-project-id"
  exit 1
fi

# Read AUTH_PASSWORD from .env file if it exists
AUTH_PASSWORD=""
if [ -f .env ]; then
  AUTH_PASSWORD=$(grep -E '^AUTH_PASSWORD=' .env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
fi

if [ -z "$AUTH_PASSWORD" ]; then
  echo "Error: AUTH_PASSWORD not found in .env file."
  echo "  Create a .env file with: AUTH_PASSWORD=your-secret-password"
  exit 1
fi

echo "==> Deploying to Cloud Run..."
echo "    Project:  $PROJECT_ID"
echo "    Region:   $REGION"
echo "    Service:  $SERVICE_NAME"
echo ""

# Deploy from source (builds via Cloud Build using Dockerfile)
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "AUTH_PASSWORD=$AUTH_PASSWORD" \
  --memory 1Gi \
  --cpu 1 \
  --timeout 600 \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1

echo ""
echo "==> Deployment complete!"
echo "    Your app URL will be shown above."
