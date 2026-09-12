#!/bin/bash
# Deploy Cloud Armor for Ms-Rooms
# Project Name: Ms-Rooms
# Project ID: 6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq
# If this ID is a reCAPTCHA key (invalid GCP ID format), replace PROJECT_ID below
# with the real ID from: gcloud projects list --filter="name:Ms-Rooms"

set -e
PROJECT_ID="6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq"
POLICY_NAME="ms-rooms-backend-security-policy"
BACKEND_SERVICE="ms-rooms-backend-service" # <-- replace with your actual backend service name

echo "Using project: $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Verify project exists
gcloud projects describe $PROJECT_ID || { echo "ERROR: Project ID invalid. Check GCP Console for correct Project ID."; exit 1; }

# 1. Create policy (global for external global LB)
gcloud compute security-policies create $POLICY_NAME \
  --description="Ms-Rooms: rate-limit 100/min/IP, geo-block, WAF sqli/xss" \
  --global

# Enable WAF JSON parsing + verbose logging
gcloud compute security-policies update $POLICY_NAME \
  --global \
  --json-parsing=STANDARD \
  --log-level=VERBOSE

# 2. Allowlist trusted CIDRs - priority 900
gcloud compute security-policies rules create 900 \
  --security-policy=$POLICY_NAME \
  --global \
  --expression="inIpRange(origin.ip, '203.0.113.0/24') || inIpRange(origin.ip, '198.51.100.10/32')" \
  --action=allow \
  --description="Allowlist trusted CIDRs"

# 3. Rate limiting 100 req/min/IP on sensitive endpoints -> 429
gcloud compute security-policies rules create 1000 \
  --security-policy=$POLICY_NAME \
  --global \
  --expression="request.path.matches('/api/sensitive/.*') || request.path.matches('/login') || request.path.matches('/admin/.*')" \
  --action=throttle \
  --rate-limit-threshold-count=100 \
  --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow \
  --exceed-action=deny-429 \
  --enforce-on-key=IP \
  --description="Rate limit sensitive endpoints 100/min/IP"

# 4. Geo-blocking high-risk regions
gcloud compute security-policies rules create 2000 \
  --security-policy=$POLICY_NAME \
  --global \
  --expression="origin.region_code == 'RU' || origin.region_code == 'KP' || origin.region_code == 'IR' || origin.region_code == 'SY' || origin.region_code == 'BY'" \
  --action=deny-403 \
  --description="Geo-block high-risk regions"

# 5. WAF sqli-v33-stable
gcloud compute security-policies rules create 3000 \
  --security-policy=$POLICY_NAME \
  --global \
  --expression="evaluatePreconfiguredExpr('sqli-v33-stable')" \
  --action=deny-403 \
  --description="WAF sqli-v33-stable"

# 6. WAF xss-v33-stable
gcloud compute security-policies rules create 3001 \
  --security-policy=$POLICY_NAME \
  --global \
  --expression="evaluatePreconfiguredExpr('xss-v33-stable')" \
  --action=deny-403 \
  --description="WAF xss-v33-stable"

# 7. Attach to backend service
echo "Attaching $POLICY_NAME to backend $BACKEND_SERVICE ..."
# List backends to confirm name:
gcloud compute backend-services list --global --project=$PROJECT_ID
# Update (uncomment after confirming name):
gcloud compute backend-services update $BACKEND_SERVICE \
  --global \
  --security-policy=$POLICY_NAME

# Verify
gcloud compute security-policies describe $POLICY_NAME --global
gcloud compute backend-services describe $BACKEND_SERVICE --global --format="get(securityPolicy)"

echo "Done."
