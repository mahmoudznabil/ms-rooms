terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# ------------------------------------------------------------
# Project: Ms-Rooms
# Project ID provided: 6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq
# NOTE: GCP Project IDs must be 6-30 chars, lowercase letters,
# numbers, hyphens, start with a letter. This value looks like
# a reCAPTCHA site key. If 'gcloud projects describe' fails,
# replace var.project_id with the real ID from GCP Console
# (e.g., ms-rooms-xxxx).
# ------------------------------------------------------------
variable "project_id" {
  type        = string
  default     = "6LdgXbQtAAAAAJAMc3Q68CFZG8_3gKeB6hErtWlq"
  description = "GCP Project ID for Ms-Rooms"
}

variable "backend_service_name" {
  type        = string
  default     = "ms-rooms-backend-service"
  description = "Existing external HTTP(S) LB backend service to protect"
}

variable "trusted_cidrs" {
  type        = list(string)
  default     = ["203.0.113.0/24", "198.51.100.10/32"]
  description = "Allowlisted CIDRs"
}

variable "blocked_regions" {
  type        = list(string)
  default     = ["RU", "KP", "IR", "SY", "BY"]
  description = "High-risk ISO 3166-1 alpha-2 region codes to deny"
}

provider "google" {
  project = var.project_id
}

# Backend security policy for Ms-Rooms
resource "google_compute_security_policy" "ms_rooms_backend_policy" {
  name        = "ms-rooms-backend-security-policy"
  description = "Ms-Rooms: rate-limit 100/min/IP, geo-block, WAF sqli/xss"
  project     = var.project_id

  advanced_options_config {
    json_parsing = "STANDARD"
    log_level    = "VERBOSE"
  }

  # 1. Allowlist trusted CIDRs - priority 900 (evaluated first)
  rule {
    action      = "allow"
    priority    = 900
    description = "Allowlist trusted CIDRs"
    match {
      expr {
        expression = "inIpRange(origin.ip, '203.0.113.0/24') || inIpRange(origin.ip, '198.51.100.10/32')"
      }
    }
  }

  # 2. Rate limiting: 100 req / 60s per IP on sensitive endpoints -> 429
  rule {
    action      = "throttle"
    priority    = 1000
    description = "Rate limit sensitive endpoints 100/min/IP -> 429"
    match {
      expr {
        expression = "request.path.matches('/api/sensitive/.*') || request.path.matches('/login') || request.path.matches('/admin/.*')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
      # Optional: ban clients that trip the limit
      # ban_duration_sec = 600
    }
  }

  # 3. Geo-blocking high-risk regions
  rule {
    action      = "deny(403)"
    priority    = 2000
    description = "Deny high-risk regions"
    match {
      expr {
        expression = "origin.region_code == 'RU' || origin.region_code == 'KP' || origin.region_code == 'IR' || origin.region_code == 'SY' || origin.region_code == 'BY'"
      }
    }
  }

  # 4. WAF - SQL Injection sqli-v33-stable
  rule {
    action      = "deny(403)"
    priority    = 3000
    description = "WAF sqli-v33-stable"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable')"
      }
    }
  }

  # 5. WAF - Cross-Site Scripting xss-v33-stable
  rule {
    action      = "deny(403)"
    priority    = 3001
    description = "WAF xss-v33-stable"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable')"
      }
    }
  }

  # Default rule
  rule {
    action   = "allow"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow"
  }
}

# Attach policy to existing external HTTP(S) LB backend service
# If backend service is managed elsewhere, import it or use gcloud update instead.
# Uncomment if backend service is managed by Terraform:

# resource "google_compute_backend_service" "ms_rooms_backend" {
#   name                  = var.backend_service_name
#   project               = var.project_id
#   load_balancing_scheme = "EXTERNAL_MANAGED" # or EXTERNAL for classic
#   security_policy       = google_compute_security_policy.ms_rooms_backend_policy.id
# }

# If backend service already exists, attach via gcloud or use this null_resource:
# Alternatively, manage attachment with Terraform data source + gcloud.

output "security_policy_self_link" {
  value = google_compute_security_policy.ms_rooms_backend_policy.self_link
}

output "security_policy_name" {
  value = google_compute_security_policy.ms_rooms_backend_policy.name
}
