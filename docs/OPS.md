# Operations Runbook — MS-ROOMS

Companion to [PRODUCTION-PLAN.md](./PRODUCTION-PLAN.md) (the plan) and
[CODE-REVIEW.md](./CODE-REVIEW.md) (the findings). This is the reference for
backup, rollback, and observability, plus the manual Cloudflare/GCP steps that
cannot be done from the repository.

---

## 1. Deploy & rollback rehearsal

The app is a single Cloudflare Pages project (`ms-rooms`): the Next.js static
export (`./out`) plus the Pages Function (`functions/api/[[path]].ts` →
`workers/backend.ts`).

**Deploy**

```bash
npm run build                 # regenerates ./out (static export)
npx wrangler pages deploy out --project-name=ms-rooms
```

**Roll back (two mechanisms)**

1. **Code/asset rollback — instant.** In the Cloudflare dashboard,
   **Workers & Pages → ms-rooms → Deployments**, click the previous production
   deployment → **Rollback to this deployment**. Pages serves the old assets and
   old Pages Function immediately. No data changes.
2. **Data rollback — only via Time Travel.** D1 changes are not reverted by a
   Pages rollback. Use the bookmark recorded before the migration (§2).

**Rehearse once on staging before relying on either.** The rehearsal is the
Exit criterion for Phase 0: deploy a build, confirm it serves, roll it back, and
confirm the old build is live again.

**Order-of-operations rule for schema + code changes:** apply the SQL migration
*first*, then deploy the code that depends on it. A code rollback (mechanism 1)
never rolls back the schema; if you must undo the schema, restore the bookmark.

---

## 2. Backups

### 2.1 Time Travel bookmarks (before any destructive migration)

```bash
# Record and SAVE the returned bookmark id outside this machine.
npx wrangler d1 time-travel info audioroom-db

# After a migration, compare; to restore:
npx wrangler d1 time-travel restore audioroom-db --bookmark <BOOKMARK_ID> --remote
```

Bookmarks are the *only* way to undo a destructive DDL change. Record one
immediately before running `migrations/0007_calls_tab.sql`,
`0009_transactions_call_charge.sql`, or `0010_attachments_nullable.sql`.

### 2.2 Nightly export

Scheduled in [`.github/workflows/backup.yml`](../.github/workflows/backup.yml)
(cron `15 3 * * *`, plus manual `workflow_dispatch`). It runs
`scripts/backup-d1.mjs`, which exports `audioroom-db --remote` to a timestamped
SQL file and uploads it to an R2 backup bucket.

**Required repository secrets** (GitHub → Settings → Secrets):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **D1 read** on `audioroom-db` and **R2 write** on the backup bucket |
| `CLOUDFLARE_ACCOUNT_ID` | the Cloudflare account id |
| `R2_BACKUP_BUCKET` | name of a dedicated backup bucket (create once: `npx wrangler r2 bucket create ms-rooms-backups`) |

The workflow also uploads a 14-day build artifact as a second copy.

### 2.3 Manual backup

```bash
npm run db:backup                       # uses R2_BACKUP_BUCKET if set
D1_DATABASE=audioroom-db node scripts/backup-d1.mjs
```

---

## 3. Observability

### 3.1 Browser errors (wired)

`components/Telemetry.tsx` installs global `error` / `unhandledrejection`
capture from `lib/telemetry.ts` on every page. It is a **no-op** until you set a
sink, so it ships safely by default.

To enable: set the build-time variable to any endpoint that accepts
`POST { events: [...] }`:

```bash
# .env.production (or the Pages build environment variable)
NEXT_PUBLIC_TELEMETRY_URL="https://<your-collector>/ingest"
```

Recommended: a small Cloudflare Worker (or your existing log backend) that
forwards to Sentry/DataDog. If you prefer the Sentry SDK directly, that is a
drop-in later — the capture points are the same.

### 3.2 Pages Function errors (wired)

The backend catch-all now logs a structured JSON line per error with a
`correlation_id` (returned to the client as `correlation_id` in the 500 body,
and no longer echoing the internal message):

```json
{"level":"error","correlation_id":"<id>","path":"/api/...","method":"POST","message":"...","stack":"..."}
```

These surface in **Cloudflare → Workers & Pages → ms-rooms → Logs**, and in
Workers Analytics / Logpush if enabled.

### 3.3 Alerts (manual — dashboard)

| Alert | Where | Condition |
|---|---|---|
| API 5xx rate | Cloudflare Analytics → Workers & Pages, or WAF/Logpush → your alerting | `5xx / total > 2%` for 5 min |
| D1 error rate | Logpush → D1 dataset, or the `overloaded`/error lines in Function logs | sustained D1 errors or `overloaded` responses |

At minimum, forward Workers Logs to Logpush (or your observability vendor) and
alert on the two conditions above. This is the Phase 0 "error tracking +
alerting" handoff.

### 3.4 Correlation in support

A user-facing error now returns `{ ok:false, error:"Internal error.",
correlation_id:"<id>" }`. Ask the user for the `correlation_id` (or read it from
your collector) and search the Function logs for it.

---

## 4. Manual handoffs (cannot be done from the repo)

These need a Cloudflare/GCP dashboard action or credentials I don't have. Each
is a prerequisite for the phase it belongs to.

| # | Action | Command / location | Phase |
|---|---|---|---|
| 1 | Create the preview D1 database | `npx wrangler d1 create audioroom-db-preview` | 0 |
| 2 | Create the preview R2 bucket | `npx wrangler r2 bucket create ms-rooms-preview` | 0 |
| 3 | Paste the preview ids into `wrangler.toml` | replace `REPLACE_WITH_PREVIEW_DATABASE_ID` | 0 |
| 4 | Create the backup R2 bucket | `npx wrangler r2 bucket create ms-rooms-backups` | 0 |
| 5 | Add GitHub secrets for backup | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_BACKUP_BUCKET` | 0 |
| 6 | Set the telemetry sink | Pages build env `NEXT_PUBLIC_TELEMETRY_URL` | 0 |
| 7 | Set Pages secrets (idempotent) | `npx wrangler pages secret put TURN_KEY_ID --project-name=ms-rooms` (also `TURN_API_TOKEN`, `RECAPTCHA_SECRET_KEY`) | 0/1 |
| 8 | Confirm `RECAPTCHA_SECRET_KEY` is set (otherwise recaptcha fails open) | Pages project settings | 1 |
| 9 | Cloudflare Rate Limiting rules | Dashboard → Security → WAF → Rate limiting | 1 |
| 10 | Delete `infra/cloud-armor/` | `git rm -r infra/cloud-armor` (targets an unused GCP LB) | 1/5 |
| 11 | Configure D1 Time Travel retention | Dashboard → D1 → `audioroom-db` → Settings | 0 |

---

## 5. Secrets checklist (Pages project)

| Secret | Purpose | Set? |
|---|---|---|
| `TURN_KEY_ID` / `TURN_API_TOKEN` | mints TURN ICE credentials | manual |
| `RECAPTCHA_SECRET_KEY` | signup bot protection — **fail-closed is required** | manual |
| `FIREBASE_PROJECT_ID` | declared but currently ignored (hardcoded `ms-rooms-auth`) | Phase 1 |
| `CALLS_ACCOUNT_ID` / `CALLS_APP_ID` / `CALLS_API_TOKEN` | Cloudflare Calls SFU (optional) | manual |

Never put server secrets in `.env.production`; that file holds only browser-public
`NEXT_PUBLIC_*` values.
