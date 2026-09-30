/**
 * BestAudioRoom backend Worker.
 *
 * Deployed to: https://bestaudiobackend.mahmoudnabil03.workers.dev/
 * Database: Cloudflare D1 (binding `DB`, see wrangler.toml).
 *
 * Plain Web-standard handler (no framework) so `npm run build` /
 * `tsc --noEmit` stay green without extra dependencies.
 */

import { R2Bucket } from "@cloudflare/workers-types";

interface Env {
  // Typed as `any` to avoid requiring @cloudflare/workers-types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DB: any;
  // Cloudflare R2 bucket for chat attachments
  CHAT_ATTACHMENTS: R2Bucket;
  // Cloudflare Calls SFU. Set via `wrangler secret put`.
  // When absent, /api/calls/session reports `configured: false`
  // and clients run in local preview mode.
  CALLS_ACCOUNT_ID?: string;
  CALLS_APP_ID?: string;
  CALLS_API_TOKEN?: string;
  // Cloudflare Realtime TURN (separate from Calls SFU). Set via `wrangler secret put`.
  // TURN_KEY_ID = Realtime TURN key ID, TURN_API_TOKEN = TURN API token (Bearer).
  // When absent, /api/turn falls back to legacy Calls turn_keys if CALLS_* exist,
  // otherwise reports `configured: false`. Nothing leaves Cloudflare.
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  // Firebase Admin (optional): if set, Worker verifies ID tokens with the Admin SDK service account.
  // Otherwise it falls back to google tokeninfo verification (no secrets needed).
  FIREBASE_PROJECT_ID?: string;
  RECAPTCHA_SITE_KEY?: string;
  RECAPTCHA_SECRET_KEY?: string;
}

// Allowed origins - configure via environment or use defaults
const ALLOWED_ORIGINS = [
  "https://bestaudiobackend.mahmoudnabil03.workers.dev",
  "https://bestaudiobackend.mahmoudxnabil.workers.dev",
  "https://ms-rooms.pages.dev",
  "https://main.ms-rooms.pages.dev",
  "https://ms-rooms-frontend.pages.dev",
  "http://localhost:3000",
  "http://localhost:3001",
];

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.includes(origin);
}

function getCorsHeaders(origin: string): Record<string, string> {
  const allowed = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    // Never let a cache serve one origin's ACAO to another origin.
    Vary: "Origin",
  };
}

function json(data: unknown, status = 200, origin?: string): Response {
  const headers = origin ? getCorsHeaders(origin) : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function notFound(message = "Not found", origin?: string): Response {
  return json({ ok: false, error: message }, 404, origin);
}

function badRequest(message: string, origin?: string): Response {
  return json({ ok: false, error: message }, 400, origin);
}

function conflict(message: string, origin?: string): Response {
  return json({ ok: false, error: message }, 409, origin);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function newId(prefix: string): string {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${r}`;
}

// Set once per isolate after the users identity columns/index exist, so we
// don't re-run DDL on every request.
let userIdentitySchemaReady = false;

// ---- Firebase ID token verification (security layer) ----
// Project: ms-room-audio (887561048772). Firebase ID tokens are RS256 JWTs
// issued by securetoken.google.com and are verified with Google's rotating
// public JWKs. Never accept a decoded-but-unverified payload here: doing so
// would let an attacker forge any firebase_uid (including a master admin).
const FIREBASE_PROJECT_ID = "ms-rooms-auth";
const FIREBASE_ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

/** THE admins: the only identities allowed to bootstrap master_admin via Firebase. */
const MASTER_ADMIN_EMAILS = ["marcamgadalfonse2004@gmail.com", "mahmoudnabil03@gmail.com"];

async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function decodeJwtPart(part: string): Record<string, unknown> | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeBase64UrlBytes(part: string): Uint8Array | null {
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

type FirebaseJwk = JsonWebKey & { kid: string; alg?: string; use?: string };
let firebaseJwksCache: { keys: FirebaseJwk[]; expiresAt: number } | null = null;

async function getFirebaseJwks(forceRefresh = false): Promise<FirebaseJwk[]> {
  if (!forceRefresh && firebaseJwksCache && firebaseJwksCache.expiresAt > Date.now()) {
    return firebaseJwksCache.keys;
  }
  const res = await fetch(FIREBASE_JWKS_URL, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Firebase JWK fetch failed (${res.status}).`);
  const data = (await res.json()) as { keys?: FirebaseJwk[] };
  const keys = (data.keys ?? []).filter((key) => key.kty === "RSA" && key.kid);
  if (keys.length === 0) throw new Error("Firebase JWK response contained no RSA keys.");
  const maxAge = Number(res.headers.get("Cache-Control")?.match(/max-age=(\d+)/i)?.[1] ?? 3600);
  firebaseJwksCache = {
    keys,
    expiresAt: Date.now() + Math.max(300, Math.min(maxAge, 86400)) * 1000,
  };
  return keys;
}

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email?: string | null;
  phone?: string | null;
  emailVerified: boolean;
  provider: string | null;
} | null> {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  const signature = decodeBase64UrlBytes(parts[2]);
  const kid = typeof header?.kid === "string" ? header.kid : "";
  if (!header || header.alg !== "RS256" || !payload || !signature || !kid) return null;

  try {
    let keys = await getFirebaseJwks();
    let jwk = keys.find((key) => key.kid === kid);
    // Google rotates keys. Refresh immediately when an unfamiliar kid arrives.
    if (!jwk) {
      keys = await getFirebaseJwks(true);
      jwk = keys.find((key) => key.kid === kid);
    }
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signatureBuffer = signature.slice().buffer as ArrayBuffer;
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signatureBuffer, signed);
    if (!valid) return null;
  } catch {
    // Fail closed if Google keys are unreachable or WebCrypto rejects the key.
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID || payload.iss !== FIREBASE_ISSUER) return null;
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!sub || sub.length > 128) return null;
  const exp = Number(payload.exp ?? 0);
  const iat = Number(payload.iat ?? 0);
  if (!Number.isFinite(exp) || exp <= now || !Number.isFinite(iat) || iat > now + 300) return null;
  return {
    uid: sub,
    email: typeof payload.email === "string" ? payload.email : null,
    phone: typeof payload.phone_number === "string" ? payload.phone_number : null,
    emailVerified: payload.email_verified === true,
    provider:
      typeof (payload.firebase as Record<string, unknown> | undefined)?.sign_in_provider === "string"
        ? ((payload.firebase as Record<string, unknown>).sign_in_provider as string)
        : null,
  };
}

const backend = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin") || "";
    return new Response(null, { status: 204, headers: getCorsHeaders(origin) });
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Local json helper that automatically includes CORS headers with origin
  const origin = request.headers.get("Origin") || "";
  const j = (data: unknown, status = 200) => json(data, status, origin);

  if (!env.DB) {
    return j({ ok: false, error: "D1 binding `DB` is not configured." }, 500);
  }

  // CSRF protection: generate token on GET /api/csrf, validate on state-changing methods
  async function generateCsrfToken(): Promise<string> {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return [...array].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function validateCsrfToken(request: Request, env: Env): Promise<boolean> {
    // Skip CSRF check for safe methods
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
    // Skip for auth endpoints that use Firebase ID tokens
    if (path.startsWith("/api/auth/firebase") || path.startsWith("/api/auth/login") || path.startsWith("/api/auth/me")) return true;
    if (path.startsWith("/api/recaptcha/")) return true;
    // Skip for admin endpoints that use admin tokens
    if (path.startsWith("/api/admin/")) return true;
    // Skip for webhook/callback endpoints
    if (path === "/api/calls/session" || path === "/api/turn") return true;
    // Follow/rooms/gifts/moments etc. are cross-origin (Pages -> Workers) with credentials:include
    // Strict cookie CSRF fails cross-site without SameSite=None. Use Origin allowlist instead.
    // Keep token check optional: if Origin is allowed, allow request (CORS protection).
    const origin = request.headers.get("Origin") || "";
    if (origin && isOriginAllowed(origin)) return true;
    // Same-origin or no Origin header: require token
    const csrfHeader = request.headers.get("X-CSRF-Token");
    const cookieHeader = request.headers.get("Cookie") || "";
    const cookieCsrf = cookieHeader.split("; ").find((c) => c.trim().startsWith("csrf_token="))?.split("=")[1];
    const csrfToken = csrfHeader || cookieCsrf;
    if (!csrfToken) return false;
    return csrfToken.length >= 32;
  }

  // CSRF token endpoint — SameSite=None for cross-origin Pages -> Workers with credentials:include
  if (path === "/api/csrf" && request.method === "GET") {
    const token = await generateCsrfToken();
    const headers = new Headers(getCorsHeaders(origin));
    headers.set("Content-Type", "application/json");
    headers.set("Set-Cookie", `csrf_token=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${24 * 60 * 60}`);
    return new Response(JSON.stringify({ ok: true, csrf_token: token }), {
      status: 200,
      headers,
    });
  }

  // CSRF validation middleware for state-changing requests
  if (["POST", "PATCH", "DELETE", "PUT"].includes(request.method)) {
    const valid = await validateCsrfToken(request, env);
    if (!valid) {
      return j({ ok: false, error: "Invalid or missing CSRF token" }, 403);
    }
  }

  try {
      // ---- reCAPTCHA verify (public site key 6LdgXbQt..., secret via RECAPTCHA_SECRET_KEY) ----
      if (path === "/api/recaptcha/verify" && request.method === "POST") {
        const body = await readJson<{ token?: unknown }>(request);
        const token = typeof body?.token === "string" ? body.token : "";
        if (!token) return j({ ok: false, error: "Missing token" }, 400);
        const secret = (env as unknown as Record<string, string | undefined>).RECAPTCHA_SECRET_KEY;
        if (!secret) {
          // No secret configured — fail open in dev, but log warning. Set via `wrangler secret put RECAPTCHA_SECRET_KEY`
          console.warn("RECAPTCHA_SECRET_KEY not set — skipping server verification");
          return j({ ok: true, warning: "RECAPTCHA_SECRET_KEY not set, verification skipped" });
        }
        try {
          const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}&remoteip=${encodeURIComponent(request.headers.get("CF-Connecting-IP") || "")}`,
          });
          const verifyData = (await verifyRes.json()) as { success?: boolean; "error-codes"?: string[] };
          if (!verifyData.success) return j({ ok: false, error: "reCAPTCHA failed", codes: verifyData["error-codes"] }, 403);
          return j({ ok: true });
        } catch (e) {
          return j({ ok: false, error: "Verification error" }, 500);
        }
      }
      if (path === "/api/recaptcha/sitekey" && request.method === "GET") {
        const key = (env as unknown as Record<string, string | undefined>).RECAPTCHA_SITE_KEY || "6LeJIbwtAAAAABfH5omBJh8H-AqwRN2l9XzmdprD";
        return j({ ok: true, siteKey: key });
      }

      // ---- Privacy Policy --------------------------------------------------
      if ((path === "/privacy-policy" || path === "/privacy") && request.method === "GET") {
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Privacy Policy — MS-ROOMS / BestAudioRoom</title>
<style>
:root{--bg:#0a0a0b;--card:#111113;--border:rgba(255,255,255,.08);--text:#fff;--muted:rgba(255,255,255,.55);--accent:#7c3aed}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-system,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:var(--bg);color:var(--text);line-height:1.6}
a{color:#a78bfa;text-decoration:none}a:hover{text-decoration:underline}
.header{max-width:900px;margin:0 auto;padding:32px 20px 0;display:flex;align-items:center;gap:12px}
.logo{width:40px;height:40px;border-radius:10px;background:rgba(0,0,0,.4);border:1px solid var(--border);display:flex;align-items:center;justify-content:center}
.wrap{max-width:900px;margin:0 auto;padding:24px 20px 48px}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px}
h1{font-size:28px;margin:8px 0 4px}h2{font-size:18px;margin:28px 0 8px;color:#fff}h3{font-size:15px;margin:18px 0 6px;color:#e9e7ff}
p,li{color:var(--muted);font-size:14px}ul{padding-left:18px}li{margin:4px 0}
.badge{display:inline-block;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.6);background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.25);padding:4px 8px;border-radius:999px}
.meta{font-size:12px;color:rgba(255,255,255,.35);margin-top:6px}
.table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
.table th,.table td{border:1px solid var(--border);padding:8px 10px;text-align:left}
.table th{background:rgba(255,255,255,.04);color:#fff}
.footer{margin-top:24px;font-size:12px;color:rgba(255,255,255,.3);text-align:center}
code{background:rgba(255,255,255,.08);padding:1px 5px;border-radius:6px;font-size:12px}
</style>
</head>
<body>
<div class="header">
  <div class="logo"><img src="/ms-rooms-logo.svg" alt="MS-ROOMS" style="width:28px;height:28px;object-fit:contain" onerror="this.style.display='none'"/></div>
  <div><div style="font-weight:600">MS-ROOMS</div><div style="font-size:12px;color:rgba(255,255,255,.4)">BestAudioRoom</div></div>
</div>
<div class="wrap">
  <div class="card">
    <span class="badge">Privacy Policy</span>
    <h1>Privacy Policy</h1>
    <div class="meta">Effective Date: September 10, 2026 &nbsp;•&nbsp; Last Updated: September 10, 2026 &nbsp;•&nbsp; Service: <code>https://bestaudiobackend.mahmoudnabil03.workers.dev</code> &nbsp;•&nbsp; Apps: MS-ROOMS (Web, Android, iOS)</div>

    <p><strong>MS-ROOMS / BestAudioRoom</strong> ("we", "us") operates audio rooms, social features, and virtual gifts. This policy explains what we collect, how we use it, and your choices. By creating an account or using MS-ROOMS you agree to this policy.</p>

    <h2>1. Who we are &amp; contact</h2>
    <p>Data controller: MS-ROOMS (BestAudioRoom). Backend hosted on <strong>Cloudflare Workers + D1</strong> (<code>bestaudiobackend.mahmoudnabil03.workers.dev</code>). Auth via <strong>Firebase (Google) project ms-room-audio</strong>.</p>
    <p>Contact: <a href="mailto:mahmoudnabil03@gmail.com">mahmoudnabil03@gmail.com</a> / <a href="mailto:marcamgadalfonse2004@gmail.com">marcamgadalfonse2004@gmail.com</a>. For deletion requests use subject "Privacy Request".</p>

    <h2>2. Information we collect</h2>
    <table class="table">
      <tr><th>Category</th><th>Examples</th><th>Source</th></tr>
      <tr><td>Account &amp; identity</td><td>Firebase UID (<code>firebase_uid</code>), email, phone, display name, avatar URL, provider (google / password / phone / email-link), username, id_tag</td><td>You + Firebase Auth</td></tr>
      <tr><td>App activity</td><td>Rooms created/joined, seats, messages/moments, follows, likes, gift sends/receives (coins spent, gems 70% to host), XP events, transactions, daily rewards, call sessions</td><td>Your use of MS-ROOMS</td></tr>
      <tr><td>Device &amp; technical</td><td>IP (<code>CF-Connecting-IP</code>), region (<code>origin.region_code</code> for Cloud Armor), user-agent, device identifiers, crash logs</td><td>Automatically</td></tr>
      <tr><td>Verification &amp; safety</td><td>reCAPTCHA token/response (site key <code>6LeJIbwtAAAAABfH5omBJh8H-AqwRN2l9XzmdprD</code>), CSRF tokens, Firebase ID token (aud=<code>ms-room-audio</code>), Cloudflare Turn/CALLS session metadata</td><td>Security checks</td></tr>
      <tr><td>Support</td><td>Reports you submit</td><td>You</td></tr>
    </table>
    <p>We do <strong>not</strong> collect payment card numbers directly — recharge is handled by app stores / payment provider; we store only package/amount/status.</p>

    <h2>3. How we use information</h2>
    <ul>
      <li>Provide audio rooms, authentication (Firebase -> D1 sync by <code>firebase_uid</code> so coins/gems/XP follow you across devices), and social features.</li>
      <li>Security: verify Firebase ID tokens, verify reCAPTCHA on registration (<code>/api/recaptcha/verify</code>), enforce rate limiting / geo-blocking / WAF via Cloud Armor, and prevent abuse.</li>
      <li>Personalize and improve (leaderboards, recommendations), analytics, and troubleshooting.</li>
      <li>Communicate about updates, support, and policy changes.</li>
      <li>Comply with law and enforce Terms.</li>
    </ul>

    <h2>4. Legal bases (EEA/UK)</h2>
    <p>Contract (provide the service), Legitimate interests (security, improvement, anti-abuse), Consent (where you give it, e.g., optional avatar), Legal obligation.</p>

    <h2>5. Sharing</h2>
    <p>We do not sell your personal information. We share only with:</p>
    <ul>
      <li><strong>Service providers / processors:</strong> Cloudflare (Workers, D1, Calls/TURN, CDN), Google Firebase/Google Cloud (Auth, tokeninfo), Google reCAPTCHA.</li>
      <li><strong>Other users:</strong> profile, room, and moment data you make public (display name, avatar, rooms, followers).</li>
      <li><strong>Legal/safety:</strong> if required by law or to protect rights/safety.</li>
      <li><strong>Business transfer:</strong> in merger/acquisition, with notice.</li>
    </ul>

    <h2>6. International transfers</h2>
    <p>Data is processed on Cloudflare's global network and Google's infrastructure and may be transferred outside your country. We rely on Standard Contractual Clauses / provider safeguards where required.</p>

    <h2>7. Retention</h2>
    <ul>
      <li>Account/D1 rows: until you delete your account (request via contact). Sessions: 30 days expiry.</li>
      <li>Logs &amp; security events (auth_audit, transactions): up to 12 months for fraud/abuse, then anonymized or deleted.</li>
      <li>Backups: retained per Cloudflare D1 retention.</li>
    </ul>

    <h2>8. Security</h2>
    <p>HTTPS, HttpOnly Secure SameSite cookies for sessions, Firebase ID token verification (<code>aud=ms-room-audio</code>), CSRF protection, Cloud Armor rate limiting / geo-blocking / WAF (SQLi/XSS v33), and least-privilege D1 access. No method is 100% secure — report vulnerabilities to the contact above.</p>

    <h2>9. Your rights &amp; choices</h2>
    <ul>
      <li>Access, correct, delete, or export your D1 data — email us or use in-app profile edit / delete.</li>
      <li>Withdraw consent where applicable.</li>
      <li>Object to or restrict certain processing.</li>
      <li>EEA/UK: lodge a complaint with your supervisory authority. California: CCPA rights (access/delete/opt-out of sale — we do not sell).</li>
    </ul>
    <p>To delete: email from your account email requesting deletion of <code>firebase_uid</code>/email. We delete D1 user, linked rooms/seats/transactions where legally permitted within 30 days.</p>

    <h2>10. Children</h2>
    <p>MS-ROOMS is not directed to children under 13 (or 16 where applicable). We do not knowingly collect from children. If you believe a child provided data, contact us for deletion.</p>

    <h2>11. Cookies &amp; similar</h2>
    <p>We use essential cookies: <code>session</code> (30-day auth) and <code>csrf_token</code> (24h). reCAPTCHA sets Google cookies to assess bot risk. Firebase may set auth cookies. You can block non-essential cookies but login/rooms will break.</p>

    <h2>12. Third-party services</h2>
    <ul>
      <li>Firebase Auth &amp; Google tokeninfo — <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a></li>
      <li>Cloudflare — <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Cloudflare Privacy Policy</a></li>
      <li>Google reCAPTCHA — <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy</a> &amp; <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Terms</a> (reCAPTCHA use is subject to them)</li>
    </ul>

    <h2>13. Changes</h2>
    <p>We will update the "Last Updated" date and, for material changes, notify in-app or by email. Continued use after the effective date means acceptance.</p>

    <h2>14. Contact</h2>
    <p>Email: <a href="mailto:mahmoudnabil03@gmail.com">mahmoudnabil03@gmail.com</a> &nbsp;•&nbsp; Alternative: <a href="mailto:marcamgadalfonse2004@gmail.com">marcamgadalfonse2004@gmail.com</a><br/>Service URL: <code>https://bestaudiobackend.mahmoudnabil03.workers.dev/privacy-policy</code></p>
  </div>
  <div class="footer">© 2026 MS-ROOMS / BestAudioRoom. This policy is provided for transparency and does not constitute legal advice.</div>
</div>
</body>
</html>`;
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            ...getCorsHeaders(origin),
          },
        });
      }

      // ---- Root / health -------------------------------------------------
      if (path === "/" && request.method === "GET") {
        const origin = request.headers.get("Origin") || "";
        return json({
          ok: true,
          service: "bestaudiobackend",
          time: new Date().toISOString(),
          endpoints: [
            "GET /health",
            "GET /api/rooms",
            "POST /api/rooms",
            "GET /api/rooms/:slug",
            "PATCH /api/rooms/:slug",
            "DELETE /api/rooms/:slug",
            "GET /api/rooms/:slug/seats",
            "POST /api/rooms/:slug/seats",
            "DELETE /api/rooms/:slug/seats/:index",
            "PATCH /api/rooms/:slug/seats/:index",
            "GET /api/users/:id",
            "PATCH /api/users/:id",
            "GET /api/users/:id/profile",
            "GET /api/users/:id/social",
            "GET /api/users/:id/transactions",
            "GET /api/users/:id/xp",
            "POST /api/auth/login",
            "GET /api/auth/me",
            "POST /api/follow",
            "DELETE /api/follow",
            "GET /api/moments",
            "POST /api/moments",
            "POST /api/moments/:id/like",
            "DELETE /api/moments/:id/like",
            "POST /api/rewards/claim",
            "POST /api/checkin",
            "GET /api/gifts",
            "POST /api/gifts/send",
            "POST /api/xp/award",
            "GET /api/recharge/packages",
            "POST /api/recharge/buy",
            "POST /api/spin",
            "GET /api/leaderboard",
            "GET /api/search",
            "POST /api/reports",
            "GET /api/reports",
            "PATCH /api/reports/:id",
            "POST /api/admin/firebase",
            "POST /api/admin/login",
            "GET /api/admin/me",
            "GET /api/admin/team",
            "POST /api/admin/team",
            "DELETE /api/admin/team/:id",
            "POST /api/admin/rooms/end",
            "GET /api/turn",
            "POST /api/calls/session",
            "POST /api/rooms/private-call",
            "POST /api/rooms/private-call/accept",
            "POST /api/rooms/private-call/reject",
            "POST /api/rooms/private-call/end",
            "POST /api/rooms/private-call/cancel",
            "POST /api/rooms/private-call/missed",
            "GET /api/rooms/private-call/status",
            "GET /api/calls",
            "GET /api/calls/incoming",
            "GET /api/calls/missed-count",
            "POST /api/calls/seen",
            "GET /api/conversations",
            "POST /api/conversations",
            "POST /api/conversations/direct",
            "GET /api/conversations/unread-count",
            "GET /api/conversations/:id",
            "POST /api/conversations/:id/participants",
            "DELETE /api/conversations/:id/participants/:userId",
            "GET /api/conversations/:id/messages",
            "POST /api/conversations/:id/messages",
            "PATCH /api/messages/:id",
            "DELETE /api/messages/:id",
            "POST /api/conversations/:id/read",
            "POST /api/ai/log",
          ],
        }, 200, origin);
      }

      if (path === "/health" && request.method === "GET") {
        const origin = request.headers.get("Origin") || "";
        return j({ ok: true, worker: "bestaudiobackend", time: new Date().toISOString() });
      }

      // ---- Rooms ----------------------------------------------------------
      if (path === "/api/rooms" && request.method === "GET") {
        const res = await env.DB.prepare(
          `SELECT r.id, r.slug, r.title, r.description, r.category, r.status,
                  r.listener_count, r.speaker_count, r.cover_color,
                  r.created_at, r.updated_at,
                  u.display_name AS host_name
           FROM rooms r
           JOIN users u ON u.id = r.host_user_id
           WHERE r.status = 'live'
           ORDER BY r.updated_at DESC`
        ).all();
        return j({ ok: true, rooms: res.results ?? [] });
      }

      const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
      if (roomMatch && request.method === "GET") {
        const slug = decodeURIComponent(roomMatch[1]);
        const room = await env.DB.prepare(
          `SELECT r.*, u.display_name AS host_name
           FROM rooms r JOIN users u ON u.id = r.host_user_id
           WHERE r.slug = ? OR r.id = ?`
        )
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.", origin);
        const seats = await env.DB.prepare(
          `SELECT s.seat_index, s.user_id, s.role, s.is_muted, s.joined_at,
                  u.display_name, u.username
           FROM seats s LEFT JOIN users u ON u.id = s.user_id
           WHERE s.room_id = ? ORDER BY s.seat_index ASC`
        )
          .bind((room as Record<string, unknown>).id)
          .all();
        return j({ ok: true, room, seats: seats.results ?? [] });
      }

      const seatsMatch = path.match(/^\/api\/rooms\/([^/]+)\/seats$/);
      if (seatsMatch) {
        const slug = decodeURIComponent(seatsMatch[1]);
        const room = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomId = (room as Record<string, unknown>).id as string;

        if (request.method === "GET") {
          const seats = await env.DB.prepare(
            `SELECT s.seat_index, s.user_id, s.role, s.is_muted, s.joined_at,
                    u.display_name, u.username
             FROM seats s LEFT JOIN users u ON u.id = s.user_id
             WHERE s.room_id = ? ORDER BY s.seat_index ASC`
          )
            .bind(roomId)
            .all();
          return j({ ok: true, room_id: roomId, seats: seats.results ?? [] });
        }

        if (request.method === "POST") {
          const body = await readJson<{ seat_index?: unknown; user_id?: unknown }>(request);
          const seatIndex = typeof body?.seat_index === "number" ? body.seat_index : -1;
          const userId = typeof body?.user_id === "string" ? body.user_id : "";
          if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 7) {
            return badRequest("seat_index must be an integer between 0 and 7.");
          }
          if (!userId) return badRequest("user_id is required.");
          const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
          if (!user) return notFound("User not found.");
          const existing = await env.DB.prepare(
            `SELECT user_id FROM seats WHERE room_id = ? AND seat_index = ?`
          )
            .bind(roomId, seatIndex)
            .first();
          if (existing && (existing as Record<string, unknown>).user_id) {
            return conflict(`Seat ${seatIndex} is already taken.`);
          }
          if (existing) {
            await env.DB.prepare(
              `UPDATE seats SET user_id = ?, role = ?, is_muted = 0, joined_at = CURRENT_TIMESTAMP
               WHERE room_id = ? AND seat_index = ?`
            )
              .bind(userId, seatIndex === 0 ? "host" : "speaker", roomId, seatIndex)
              .run();
          } else {
            await env.DB.prepare(
              `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
               VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
            )
              .bind(roomId, seatIndex, userId, seatIndex === 0 ? "host" : "speaker")
              .run();
          }
          return j({ ok: true, room_id: roomId, seat_index: seatIndex, user_id: userId });
        }

        return notFound();
      }

      const seatOneMatch = path.match(/^\/api\/rooms\/([^/]+)\/seats\/(\d+)$/);
      if (seatOneMatch) {
        const slug = decodeURIComponent(seatOneMatch[1]);
        const seatIndex = Number(seatOneMatch[2]);
        if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 7) {
          return badRequest("Seat index must be between 0 and 7.");
        }
        const room = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomId = (room as Record<string, unknown>).id as string;

        if (request.method === "DELETE") {
          await env.DB.prepare(`UPDATE seats SET user_id = NULL WHERE room_id = ? AND seat_index = ?`)
            .bind(roomId, seatIndex)
            .run();
          return j({ ok: true, room_id: roomId, seat_index: seatIndex, freed: true });
        }

        if (request.method === "PATCH") {
          const body = await readJson<{ is_muted?: unknown }>(request);
          if (typeof body?.is_muted !== "boolean" && typeof body?.is_muted !== "number") {
            return badRequest("is_muted (boolean) is required.");
          }
          const muted = body.is_muted ? 1 : 0;
          await env.DB.prepare(`UPDATE seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?`)
            .bind(muted, roomId, seatIndex)
            .run();
          return j({ ok: true, room_id: roomId, seat_index: seatIndex, is_muted: muted });
        }

        return notFound();
      }

      // Username availability check for FB/IG-style renames.
      // NOTE: must sit BEFORE the generic /api/users/:id GET match below,
      // otherwise "check-username" would be treated as a user id.
      if (path === "/api/users/check-username" && request.method === "GET") {
        const name = (url.searchParams.get("username") ?? "").trim();
        if (!/^[A-Za-z0-9_.-]{2,24}$/.test(name)) {
          return j({ ok: true, available: false, reason: "Username must be 2-24 chars: letters, numbers, _ . -" });
        }
        const taken = await env.DB.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`).bind(name).first();
        const excludeId = url.searchParams.get("exclude_id") ?? "";
        if (taken && (taken as Record<string, unknown>).id !== excludeId) {
          return j({ ok: true, available: false, reason: "That username is taken." });
        }
        return j({ ok: true, available: true });
      }

      // ---- Users -----------------------------------------------------------
      // Lookup accepts id, username (case-insensitive), or id_tag so
      // /profile/<username> links from search resolve by handle.
      async function resolveUser(key: string): Promise<Record<string, unknown> | null> {
        const k = key.trim();
        if (!k) return null;
        let u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(k).first();
        if (u) return u as Record<string, unknown>;
        u = await env.DB.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).bind(k).first();
        if (u) return u as Record<string, unknown>;
        u = await env.DB.prepare(`SELECT * FROM users WHERE id_tag = ? COLLATE NOCASE`).bind(k).first();
        if (u) return u as Record<string, unknown>;
        return null;
      }

      // ---- Universal outside-ID: every user row carries a stable unique `id`
      // plus a human-readable unique `id_tag` (BASE#NNNN), no matter how they
      // signed up (username, Google, email/password, phone). Admins find, ban
      // and promote users by id, username, or id_tag.
      async function ensureUserIdentityColumns(): Promise<void> {
        if (userIdentitySchemaReady) return;
        for (const ddl of [
          "ALTER TABLE users ADD COLUMN id_tag TEXT",
          "ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0",
          "ALTER TABLE users ADD COLUMN ban_reason TEXT",
        ]) {
          try {
            await env.DB.prepare(ddl).run();
          } catch {
            // column already exists
          }
        }
        try {
          await env.DB.prepare(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_tag ON users(id_tag) WHERE id_tag IS NOT NULL`
          ).run();
        } catch {}
        // One-time backfill for rows created before id_tag existed.
        try {
          const rows = await env.DB
            .prepare(`SELECT id, username FROM users WHERE id_tag IS NULL OR id_tag = '' LIMIT 1000`)
            .all();
          for (const r of ((rows.results ?? []) as Array<Record<string, unknown>>)) {
            const base = ((r.username as string) || "user").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "user";
            const stem = (base.toUpperCase().replace(/[^A-Z0-9]/g, "") || "USER").slice(0, 8);
            for (let i = 0; i < 5; i++) {
              const tag = `${stem}#${Math.floor(1000 + Math.random() * 9000)}`;
              try {
                await env.DB.prepare(`UPDATE users SET id_tag = ? WHERE id = ? AND (id_tag IS NULL OR id_tag = '')`).bind(tag, r.id).run();
                break;
              } catch {}
            }
          }
        } catch {}
        userIdentitySchemaReady = true;
      }

      async function makeUniqueIdTag(base: string): Promise<string> {
        const stem = ((base || "user").toUpperCase().replace(/[^A-Z0-9]/g, "") || "USER").slice(0, 8);
        for (let i = 0; i < 8; i++) {
          const tag = `${stem}#${Math.floor(1000 + Math.random() * 9000)}`;
          const taken = await env.DB.prepare(`SELECT id FROM users WHERE id_tag = ?`).bind(tag).first();
          if (!taken) return tag;
        }
        return `${stem}#${Date.now().toString(36).toUpperCase().slice(-6)}`;
      }

      async function backfillIdentity(userId: string): Promise<void> {
        const row = (await env.DB.prepare(`SELECT id, username, id_tag FROM users WHERE id = ?`).bind(userId).first()) as Record<string, unknown> | null;
        if (!row || row.id_tag) return;
        const base = ((row.username as string) || "user").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "user";
        for (let i = 0; i < 5; i++) {
          try {
            await env.DB.prepare(`UPDATE users SET id_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (id_tag IS NULL OR id_tag = '')`).bind(await makeUniqueIdTag(base), userId).run();
            return;
          } catch {}
        }
      }
      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && request.method === "GET") {
        const id = decodeURIComponent(userMatch[1]);
        const user = await resolveUser(id);
        if (!user) return notFound("User not found.");
        return j({ ok: true, user });
      }

      const txMatch = path.match(/^\/api\/users\/([^/]+)\/transactions$/);
      if (txMatch && request.method === "GET") {
        const id = decodeURIComponent(txMatch[1]);
        const tx = await env.DB.prepare(
          `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
        )
          .bind(id)
          .all();
        return j({ ok: true, transactions: tx.results ?? [] });
      }

      // ---- Daily reward ------------------------------------------------------
      if (path === "/api/rewards/claim" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 100;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
          return badRequest("amount must be between 1 and 1000.");
        }
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const claimed = await env.DB.prepare(
          `SELECT id FROM transactions
           WHERE user_id = ? AND type = 'daily_reward' AND created_at >= date('now', 'start of day') LIMIT 1`
        )
          .bind(userId)
          .first();
        if (claimed) return conflict("Daily reward already claimed today.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'daily_reward', ?, 'Daily check-in reward')`
        )
          .bind(newId("tx"), userId, amount)
          .run();
        const updated = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return json({
          ok: true,
          user_id: userId,
          credited: amount,
          coins: (updated as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Gifts (Triple-Currency: Coins spent, Gems earned 70% to host, XP progression) ---------
      if (path === "/api/gifts/send" && request.method === "POST") {
        const body = await readJson<{
          from_user_id?: unknown;
          room_id?: unknown;
          gift_id?: unknown;
          cost?: unknown;
        }>(request);
        const fromUserId = typeof body?.from_user_id === "string" ? body.from_user_id : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        const giftId = typeof body?.gift_id === "string" ? body.gift_id : "gift";
        const cost = typeof body?.cost === "number" ? Math.floor(body.cost) : 0;
        if (!fromUserId) return badRequest("from_user_id is required.");
        if (!Number.isFinite(cost) || cost <= 0) return badRequest("cost must be a positive number.");
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(fromUserId).first();
        if (!user) return notFound("Sender not found.");
        if (((user as Record<string, unknown>).coins as number) < cost) {
          return conflict("Not enough coins.");
        }
        await env.DB.prepare(`UPDATE users SET coins = coins - ?, xp = xp + 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(cost, fromUserId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, room_id, type, amount, description)
           VALUES (?, ?, ?, 'gift_sent', ?, ?)`
        )
          .bind(newId("tx"), fromUserId, roomId, -Math.abs(cost), `Gift: ${giftId}`)
          .run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason, room_id) VALUES (?, ?, 2, 'Sent gift', ?)`).bind(newId("xp"), fromUserId, roomId).run();
        // Credit host Gems at 70% revenue share if room exists
        if (roomId) {
          try {
            const room = await env.DB.prepare(`SELECT host_user_id FROM rooms WHERE id = ?`).bind(roomId).first();
            const hostId = (room as Record<string, unknown> | null)?.host_user_id as string | undefined;
            if (hostId && hostId !== fromUserId) {
              const gemsEarned = Math.floor(cost * 0.7);
              await env.DB.prepare(`UPDATE users SET gems = gems + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(gemsEarned, hostId).run();
              await env.DB.prepare(`INSERT INTO transactions (id, user_id, room_id, type, amount, description) VALUES (?, ?, ?, 'gift_received', ?, ?)`).bind(newId("tx"), hostId, roomId, gemsEarned, `Gem earn: ${giftId} from ${fromUserId}`).run();
            }
          } catch {}
        }
        const updated = await env.DB.prepare(`SELECT coins, gems, xp FROM users WHERE id = ?`).bind(fromUserId).first();
        return j({
          ok: true,
          from_user_id: fromUserId,
          gift_id: giftId,
          cost,
          coins: (updated as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Auth (username login, D1-backed sessions) ---------------------------
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = await readJson<{ username?: unknown }>(request);
        const username = typeof body?.username === "string" ? body.username.trim() : "";
        if (!/^[A-Za-z0-9 _.-]{2,24}$/.test(username)) {
          return badRequest("username must be 2-24 chars (letters, numbers, space, _ . -).");
        }
        await ensureUserIdentityColumns();
        let user = await env.DB.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`)
          .bind(username)
          .first();
        if (!user) {
          const slug = username.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "guest";
          const id = `user-${slug}-${Math.floor(Math.random() * 1e6)}`;
          const idTag = await makeUniqueIdTag(slug);
          await env.DB.prepare(
            `INSERT INTO users (id, username, display_name, bio, coins, xp, id_tag)
             VALUES (?, ?, ?, '', 100, 0, ?)`
          )
            .bind(id, username, username, idTag)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        }
        const userId = (user as Record<string, unknown>).id as string;
        const token = `sess_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, expires_at)
           VALUES (?, ?, datetime('now', '+30 days'))`
        )
          .bind(token, userId)
          .run();
        // Set HttpOnly cookie
        const cookieHeaders = getCorsHeaders(origin);
        cookieHeaders["Set-Cookie"] = `session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
        return new Response(JSON.stringify({ ok: true, user }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...cookieHeaders },
        });
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        // Read token from cookie first, then fall back to Authorization header for backward compatibility
        const cookieHeader = request.headers.get("Cookie") || "";
        const cookieToken = cookieHeader.split("; ").find((c) => c.trim().startsWith("session="))?.split("=")[1];
        const authHeader = request.headers.get("Authorization") ?? "";
        const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const token = cookieToken || headerToken;
        
        if (!token) return badRequest("Missing session token.");
        await ensureUserIdentityColumns();
        const user = await env.DB.prepare(
          `SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
           WHERE s.id = ? AND s.expires_at > datetime('now')`
        )
          .bind(token)
          .first();
        if (!user) return j({ ok: false, error: "Invalid or expired session." }, 401);
        const meRow = user as Record<string, unknown>;
        if (!meRow.id_tag) {
          await backfillIdentity(meRow.id as string);
          const fresh = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(meRow.id).first();
          if (fresh) return bannedOrUser(fresh as Record<string, unknown>);
        }
        return bannedOrUser(meRow);
      }

      // Shared: banned users get their sessions wiped and a 403, everyone
      // else passes through. Defined here so /api/auth/me uses it.
      async function bannedOrUser(row: Record<string, unknown>): Promise<Response> {
        if (Number(row.banned ?? 0) === 1) {
          try {
            await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.id).run();
          } catch {}
          const reason = (row.ban_reason as string) || "";
          return j({ ok: false, error: `This account has been banned.${reason ? ` Reason: ${reason}` : ""}` }, 403);
        }
        return j({ ok: true, user: row });
      }

      // ---- Logout ----
      if (path === "/api/auth/logout" && request.method === "POST") {
        const cookieHeader = request.headers.get("Cookie") || "";
        const cookieToken = cookieHeader.split("; ").find((c) => c.trim().startsWith("session="))?.split("=")[1];
        if (cookieToken) {
          await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(cookieToken).run();
        }
        const cookieHeaders = getCorsHeaders(origin);
        cookieHeaders["Set-Cookie"] = `session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...cookieHeaders },
        });
      }

      // ---- Firebase Auth (phone, email/password, email link, Google)  ----
      // Security layer: Firebase is the identity provider, D1 is the source of truth.
      // The client signs in with Firebase, gets an ID token, then POSTs it here.
      // We verify the token via Google tokeninfo (aud == ms-room-audio), then upsert
      // the D1 user by firebase_uid so coins/xp/rooms/moments follow the identity
      // across any device. All progress mutations remain server-side in D1.
      if (path === "/api/auth/firebase" && request.method === "POST") {
        const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        if (!idToken) return json({ ok: false, error: "Missing Firebase ID token." }, 401);
        await ensureUserIdentityColumns();
        const verified = await verifyFirebaseIdToken(idToken);
        if (!verified) return json({ ok: false, error: "Invalid or expired Firebase ID token." }, 401);
        const body = await readJson<{
          firebase_uid?: unknown;
          email?: unknown;
          phone?: unknown;
          display_name?: unknown;
          avatar_url?: unknown;
          provider?: unknown;
        }>(request);
        const claimedUid = typeof body?.firebase_uid === "string" ? body.firebase_uid : "";
        if (claimedUid && claimedUid !== verified.uid) {
          return json({ ok: false, error: "Firebase UID mismatch." }, 403);
        }
        const firebaseUid = verified.uid;
        const email = (typeof body?.email === "string" ? body.email.trim().toLowerCase() : verified.email ?? null) || null;
        const phone = (typeof body?.phone === "string" ? body.phone.trim() : verified.phone ?? null) || null;
        const displayName = typeof body?.display_name === "string" ? body.display_name.trim().slice(0, 24) : null;
        const avatarUrl = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 500) : null;
        const provider = typeof body?.provider === "string" ? body.provider.slice(0, 40) : "firebase";

        // Lazy migration for older DBs that haven't run migrate-firebase.sql yet
        for (const ddl of [
          "ALTER TABLE users ADD COLUMN firebase_uid TEXT",
          "ALTER TABLE users ADD COLUMN email TEXT",
          "ALTER TABLE users ADD COLUMN phone TEXT",
          "ALTER TABLE users ADD COLUMN provider TEXT",
        ]) {
          try {
            await env.DB.prepare(ddl).run();
          } catch {
            // column already exists
          }
        }
        try {
          await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL").run();
        } catch {}
        try {
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_audit (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)").run();
        } catch {}

        let user = await env.DB.prepare(`SELECT * FROM users WHERE firebase_uid = ?`).bind(firebaseUid).first();
        if (!user && email) {
          user = await env.DB.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).bind(email).first();
        }
        if (!user && phone) {
          user = await env.DB.prepare(`SELECT * FROM users WHERE phone = ?`).bind(phone).first();
        }
        // First-run signal for the onboarding tour (fresh row created below).
        let isNew = false;
        if (!user) {
          isNew = true;
          const base = (displayName || email?.split("@")[0] || phone || "user").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "user";
          const id = `user-${base}-${Math.floor(Math.random() * 1e6)}`;
          const username = `${base}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
          const idTag = await makeUniqueIdTag(base);
          await env.DB.prepare(
            `INSERT INTO users (id, username, display_name, avatar_url, frame_style, id_tag, email, phone, firebase_uid, provider, bio, coins, xp, streak)
             VALUES (?, ?, ?, ?, 'default', ?, ?, ?, ?, ?, '', 100, 0, 0)`
          )
            .bind(id, username, displayName || base, avatarUrl, idTag, email, phone, firebaseUid, provider)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        } else {
          const row = user as Record<string, unknown>;
          const patchName = displayName && !row.display_name ? displayName : null;
          const patchAvatar = avatarUrl && !row.avatar_url ? avatarUrl : null;
          await env.DB.prepare(
            `UPDATE users SET firebase_uid = COALESCE(firebase_uid, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?),
                    display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), provider = COALESCE(provider, ?),
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
            .bind(firebaseUid, email, phone, patchName, patchAvatar, provider, row.id)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(row.id).first();
        }
        const userId = (user as Record<string, unknown>).id as string;
        // Banned users never get a fresh session (also enforced in /api/auth/me).
        if (Number((user as Record<string, unknown>).banned ?? 0) === 1) {
          const reason = ((user as Record<string, unknown>).ban_reason as string) || "";
          return j({ ok: false, error: `This account has been banned.${reason ? ` Reason: ${reason}` : ""}` }, 403);
        }
        const token = `sess_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).bind(token, userId).run();
        try {
          await env.DB.prepare(`INSERT INTO auth_audit (id, user_id, firebase_uid, provider) VALUES (?, ?, ?, ?)`).bind(newId("audit"), userId, firebaseUid, provider).run();
        } catch {}
        // Set HttpOnly cookie
        const cookieHeaders = getCorsHeaders(origin);
        cookieHeaders["Set-Cookie"] = `session=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
        return new Response(JSON.stringify({ ok: true, user, isNew }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...cookieHeaders },
        });
      }

      // ---- XP --------------------------------------------------------------------
      if (path === "/api/xp/award" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown; reason?: unknown; room_id?: unknown }>(
          request
        );
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 0;
        const reason = typeof body?.reason === "string" ? body.reason.slice(0, 120) : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 500) {
          return badRequest("amount must be a non-zero integer within ±500.");
        }
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        await env.DB.prepare(`UPDATE users SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO xp_events (id, user_id, amount, reason, room_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(newId("xp"), userId, amount, reason, roomId)
          .run();
        const updatedXp = await env.DB.prepare(`SELECT xp FROM users WHERE id = ?`).bind(userId).first();
        return j({
          ok: true,
          user_id: userId,
          awarded: amount,
          xp: (updatedXp as Record<string, unknown> | null)?.xp ?? null,
        });
      }

      const xpHistoryMatch = path.match(/^\/api\/users\/([^/]+)\/xp$/);
      if (xpHistoryMatch && request.method === "GET") {
        const id = decodeURIComponent(xpHistoryMatch[1]);
        const events = await env.DB.prepare(
          `SELECT * FROM xp_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
        )
          .bind(id)
          .all();
        return j({ ok: true, events: events.results ?? [] });
      }

      // ---- Gift catalog ---------------------------------------------------------------
      if (path === "/api/gifts" && request.method === "GET") {
        const catalog = await env.DB.prepare(`SELECT * FROM gift_catalog ORDER BY cost ASC`).all();
        return j({ ok: true, gifts: catalog.results ?? [] });
      }

      // ---- Rooms: create / update / end ----------------------------------------------
      if (path === "/api/rooms" && request.method === "POST") {
        const body = await readJson<{
          host_user_id?: unknown;
          title?: unknown;
          description?: unknown;
          category?: unknown;
          cover_color?: unknown;
          capacity?: unknown;
          locked?: unknown;
        }>(request);
        const hostId = typeof body?.host_user_id === "string" ? body.host_user_id : "";
        const title = typeof body?.title === "string" ? body.title.trim() : "";
        const description = typeof body?.description === "string" ? body.description.trim().slice(0, 200) : "";
        const category = typeof body?.category === "string" ? body.category : "Chat";
        const cover = typeof body?.cover_color === "string" ? body.cover_color.slice(0, 16) : "#2c3140";
        const capacity = body?.capacity === 4 || body?.capacity === 12 ? (body.capacity as number) : 8;
        const locked = body?.locked === 1 || body?.locked === true ? 1 : 0;
        if (!hostId) return badRequest("host_user_id is required.");
        if (title.length < 2 || title.length > 40) return badRequest("title must be 2-40 characters.");
        const allowedCats = ["Chill", "Music", "Community", "Chat", "Karaoke", "Games"];
        if (!allowedCats.includes(category)) return badRequest("Invalid category.");
        const host = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(hostId).first();
        if (!host) return notFound("Host user not found.");
        const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "room";
        let slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        const clash = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ?`).bind(slug).first();
        if (clash) slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
        const id = newId("room");
        await env.DB.prepare(
          `INSERT INTO rooms (id, slug, title, description, host_user_id, category, status, locked, capacity, cover_color)
           VALUES (?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)`
        )
          .bind(id, slug, title, description, hostId, category, locked, capacity, cover)
          .run();
        await env.DB.prepare(
          `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
           VALUES (?, 0, ?, 'host', 0, CURRENT_TIMESTAMP)`
        )
          .bind(id, hostId)
          .run();
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first();
        return j({ ok: true, room }, 201);
      }

      // ---- Private 1-on-1 Call Room Creation (with coin payment) ----
      if (path === "/api/rooms/private-call" && request.method === "POST") {
        const body = await readJson<{
          caller_user_id?: unknown;
          callee_user_id?: unknown;
          call_price_per_minute?: unknown;
          media?: unknown;
        }>(request);
        const callerId = typeof body?.caller_user_id === "string" ? body.caller_user_id : "";
        const calleeId = typeof body?.callee_user_id === "string" ? body.callee_user_id : "";
        const pricePerMinute = typeof body?.call_price_per_minute === "number" ? body.call_price_per_minute : 10;
        const media = body?.media === "video" ? "video" : "audio";
        if (!callerId) return badRequest("caller user_id (caller_user_id) is required.");
        if (!calleeId) return badRequest("callee_user_id is required.");
        if (callerId === calleeId) return badRequest("Cannot call yourself.");
        if (!Number.isInteger(pricePerMinute) || pricePerMinute < 0) return badRequest("call_price_per_minute must be a non-negative integer.");

        const caller = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(callerId).first();
        if (!caller) return notFound("Caller not found.");
        const callee = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(calleeId).first();
        if (!callee) return notFound("Callee not found.");

        // Check if there's already an active private call between these users
        const existingCall = await env.DB.prepare(
          `SELECT s.id FROM private_call_sessions s WHERE s.status IN ('initiated', 'ringing', 'connected') AND
           ((s.caller_user_id = ? AND s.callee_user_id = ?) OR (s.caller_user_id = ? AND s.callee_user_id = ?))`
        ).bind(callerId, calleeId, calleeId, callerId).first();
        if (existingCall) return conflict("A call is already active between you two.");

        // Check caller has enough coins for at least 1 minute
        const callerCoins = (caller as Record<string, unknown>).coins as number;
        if (callerCoins < pricePerMinute) return conflict("Not enough coins to start a call. Minimum 1 minute required.");

        const base = `call-${Date.now()}`;
        let slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        const clash = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ?`).bind(slug).first();
        if (clash) slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
        const id = newId("room");
        const roomId = id;

        // Create private room
        await env.DB.prepare(
          `INSERT INTO rooms (id, slug, title, description, host_user_id, category, status, locked, capacity, cover_color, is_private, call_participant_user_id, call_price_per_minute)
           VALUES (?, ?, ?, ?, ?, 'Call', 'live', 1, 2, '#7c3aed', 1, ?, ?)`
        )
          .bind(id, slug, `Private Call`, `Private 1-on-1 call`, callerId, calleeId, pricePerMinute)
          .run();

        // Create seats for caller (host) and callee (participant)
        await env.DB.prepare(
          `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
           VALUES (?, 0, ?, 'host', 0, CURRENT_TIMESTAMP)`
        ).bind(roomId, callerId).run();
        await env.DB.prepare(
          `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
           VALUES (?, 1, ?, 'speaker', 0, CURRENT_TIMESTAMP)`
        ).bind(roomId, calleeId).run();

        // Create private call session — starts RINGING so the callee's
        // incoming-call UI appears (the old code left it 'initiated',
        // which no client ever polled for, so calls never rang).
        const callSessionId = newId("call");
        await env.DB.prepare(
          `INSERT INTO private_call_sessions (id, room_id, caller_user_id, callee_user_id, price_per_minute, media, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ringing', CURRENT_TIMESTAMP)`
        ).bind(callSessionId, roomId, callerId, calleeId, pricePerMinute, media).run();

        // Charge caller for 1 minute upfront
        await env.DB.prepare(`UPDATE users SET coins = coins - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(pricePerMinute, callerId).run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, room_id, type, amount, description) VALUES (?, ?, ?, 'call_charge', ?, ?)`
        ).bind(newId("tx"), callerId, roomId, -pricePerMinute, `1-on-1 call with ${(await env.DB.prepare(`SELECT display_name FROM users WHERE id = ?`).bind(calleeId).first())?.display_name ?? 'User'}`).run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason, room_id) VALUES (?, ?, 2, 'Started 1-on-1 call', ?)`).bind(newId("xp"), callerId, roomId).run();

        // Create call transaction log (references the real session id)
        await env.DB.prepare(
          `INSERT INTO call_transactions (id, call_session_id, user_id, amount, description) VALUES (?, ?, ?, ?, ?)`
        ).bind(newId("ctxn"), callSessionId, callerId, -pricePerMinute, `Initial 1-min charge for 1-on-1 call`).run();

        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first();
        return j({ ok: true, room, call_session_id: callSessionId, media }, 201);
      }

      // ---- Room Edit (PATCH/DELETE) ---------------------------------------------------
      const roomEditMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
      if (roomEditMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        const slug = decodeURIComponent(roomEditMatch[1]);
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomRow = room as Record<string, unknown>;
        if (request.method === "DELETE") {
          const hostId = url.searchParams.get("host_user_id") ?? "";
          if (hostId !== roomRow.host_user_id) {
            return j({ ok: false, error: "Only the host can end this room." }, 403);
          }
          await env.DB.prepare(`UPDATE rooms SET status = 'ended', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .bind(roomRow.id)
            .run();
return j({ ok: true, ended: true });
        }
        const body = await readJson<{ host_user_id?: unknown; title?: unknown; description?: unknown }>(request);
        if (body?.host_user_id !== roomRow.host_user_id) {
          return j({ ok: false, error: "Only the host can edit this room." }, 403);
        }
        const title = typeof body?.title === "string" ? body.title.trim() : null;
        const description = typeof body?.description === "string" ? body.description.trim().slice(0, 200) : null;
        if (title !== null && (title.length < 2 || title.length > 40)) {
          return badRequest("title must be 2-40 characters.");
        }
        await env.DB.prepare(
          `UPDATE rooms SET title = COALESCE(?, title), description = COALESCE(?, description),
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(title, description, roomRow.id)
          .run();
        const updatedRoom = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(roomRow.id).first();
        return j({ ok: true, room: updatedRoom });
      }

      // ---- Follow graph -----------------------------------------------------------------
      if (path === "/api/follow" && (request.method === "POST" || request.method === "DELETE")) {
        const body = await readJson<{ follower_id?: unknown; followee_id?: unknown }>(request);
        const followerId = typeof body?.follower_id === "string" ? body.follower_id : "";
        const followeeId = typeof body?.followee_id === "string" ? body.followee_id : "";
        if (!followerId || !followeeId) return badRequest("follower_id and followee_id are required.");
        if (followerId === followeeId) return badRequest("You cannot follow yourself.");
        for (const uid of [followerId, followeeId]) {
          const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
          if (!u) return notFound("User not found.");
        }
        if (request.method === "POST") {
          await env.DB.prepare(`INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)`)
            .bind(followerId, followeeId)
            .run();
          return j({ ok: true, following: true });
        }
        await env.DB.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`)
          .bind(followerId, followeeId)
          .run();
        return j({ ok: true, following: false });
      }

      const socialMatch = path.match(/^\/api\/users\/([^/]+)\/social$/);
      if (socialMatch && request.method === "GET") {
        const rawKey = decodeURIComponent(socialMatch[1]);
        const resolved = await resolveUser(rawKey);
        if (!resolved) return notFound("User not found.");
        const id = resolved.id as string;
        const viewer = url.searchParams.get("viewer_id") ?? "";
        const counts = await env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following`
        )
          .bind(id, id)
          .first();
        const followers = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f
           JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?
           ORDER BY f.created_at DESC LIMIT 12`
        )
          .bind(id)
          .all();
        const following = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f
           JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?
           ORDER BY f.created_at DESC LIMIT 12`
        )
          .bind(id)
          .all();
        let followedByViewer = false;
        if (viewer) {
          const f = await env.DB.prepare(`SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?`)
            .bind(viewer, id)
            .first();
          followedByViewer = !!f;
        }
        return j({
          ok: true,
          followers: (counts as Record<string, unknown> | null)?.followers ?? 0,
          following: (counts as Record<string, unknown> | null)?.following ?? 0,
          followers_list: followers.results ?? [],
          following_list: following.results ?? [],
          followed_by_viewer: followedByViewer,
        });
      }

      // ---- Profile -------------------------------------------------------------------------
      // Uses resolveUser() above (id, username case-insensitive, or id_tag).
      const profileMatch = path.match(/^\/api\/users\/([^/]+)\/profile$/);
      if (profileMatch && request.method === "GET") {
        const id = decodeURIComponent(profileMatch[1]);
        const user = await resolveUser(id);
        if (!user) return notFound("User not found.");
        const stats = await env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
                  (SELECT COUNT(*) FROM rooms WHERE host_user_id = ? AND status = 'live') AS live_rooms,
                  (SELECT COUNT(*) FROM moments WHERE user_id = ?) AS moments,
                  (SELECT COALESCE(SUM(-t.amount), 0) FROM transactions t
                   JOIN rooms r ON r.id = t.room_id
                   WHERE r.host_user_id = ? AND t.type = 'gift_sent') AS gifts_received,
                  (SELECT COALESCE(SUM(-t.amount), 0) FROM transactions t
                   WHERE t.user_id = ? AND t.type = 'gift_sent') AS gifts_sent`
        )
          .bind(user.id, user.id, user.id, user.id, user.id, user.id)
          .first();
        return j({ ok: true, user, stats: stats ?? {} });
      }

      // Username availability check for FB/IG-style renames.
      // (Handler lives above, before the generic /api/users/:id GET match.)
      const userPatchMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userPatchMatch && request.method === "PATCH") {
        const id = decodeURIComponent(userPatchMatch[1]);
        const found = await resolveUser(id);
        if (!found) return notFound("User not found.");
        const realId = found.id as string;
        const body = await readJson<{ display_name?: unknown; bio?: unknown; avatar_url?: unknown; username?: unknown }>(request);
        const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : null;
        const bio = typeof body?.bio === "string" ? body.bio.trim().slice(0, 160) : null;
        // avatar_url: https URL, data:image:... upload (client-resized), or a color id.
        const avatar = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 150000) : null;
        const username = typeof body?.username === "string" ? body.username.trim() : null;
        if (displayName !== null && (displayName.length < 2 || displayName.length > 24)) {
          return badRequest("Display name must be 2-24 characters.");
        }
        if (username !== null) {
          if (!/^[A-Za-z0-9_.-]{2,24}$/.test(username)) {
            return badRequest("Username must be 2-24 chars: letters, numbers, _ . - (no spaces).");
          }
          const clash = await env.DB.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`).bind(username).first();
          if (clash && (clash as Record<string, unknown>).id !== realId) {
            return conflict("That username is taken. Try another.");
          }
        }
        if (avatar !== null) {
          const okAvatar =
            avatar.length === 0 ||
            avatar.startsWith("http://") || avatar.startsWith("https://") ||
            avatar.startsWith("data:image/") || avatar.startsWith("blob:") ||
            /^(violet|ocean|sunset|forest|midnight|aurora|default)$/.test(avatar);
          if (!okAvatar) return badRequest("Avatar must be an image URL, an uploaded photo, or a color.");
        }
        await env.DB.prepare(
          `UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio),
           avatar_url = COALESCE(?, avatar_url), username = COALESCE(?, username), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(displayName, bio, avatar, username, realId)
          .run();
        const updatedUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(realId).first();
        return j({ ok: true, user: updatedUser });
      }

      // ---- Delete My Data (GDPR) -----------------------------------------------------------------
      if (path === "/api/users/me/delete" && request.method === "POST") {
        // Get user from session cookie
        const cookieHeader = request.headers.get("Cookie") || "";
        const cookieToken = cookieHeader.split("; ").find((c) => c.trim().startsWith("session="))?.split("=")[1];
        if (!cookieToken) return badRequest("Missing session token.");
        
        const session = await env.DB.prepare(`SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`).bind(cookieToken).first();
        if (!session) return j({ ok: false, error: "Invalid or expired session." }, 401);
        
        const userId = (session as Record<string, unknown>).user_id as string;
        
        // Delete all user data (cascading deletes will handle related records)
        await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
        
        // Also delete the session
        if (cookieToken) {
          await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(cookieToken).run();
        }
        
        // Clear session cookie
        const cookieHeaders = getCorsHeaders(origin);
        cookieHeaders["Set-Cookie"] = `session=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
        
        return new Response(JSON.stringify({ ok: true, message: "Account and all data deleted" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...cookieHeaders },
        });
      }

      // ---- Moments feed ----------------------------------------------------------------------
      if (path === "/api/moments" && request.method === "GET") {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        const viewerId = url.searchParams.get("viewer_id") ?? "";
        const feed = await env.DB.prepare(
          `SELECT m.id, m.text, m.created_at, m.user_id,
                  u.username, u.display_name, u.avatar_url,
                  (SELECT COUNT(*) FROM moment_likes l WHERE l.moment_id = m.id) AS likes,
                  ${viewerId ? "EXISTS(SELECT 1 FROM moment_likes l2 WHERE l2.moment_id = m.id AND l2.user_id = ?) AS liked" : "0 AS liked"}
           FROM moments m JOIN users u ON u.id = m.user_id
           ORDER BY m.created_at DESC LIMIT ?`
        );
        const res = viewerId ? await feed.bind(viewerId, limit).all() : await feed.bind(limit).all();
        return j({ ok: true, moments: res.results ?? [] });
      }

      if (path === "/api/moments" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; text?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!userId) return badRequest("user_id is required.");
        if (text.length < 1 || text.length > 280) return badRequest("Moment must be 1-280 characters.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const id = newId("moment");
        await env.DB.prepare(`INSERT INTO moments (id, user_id, text) VALUES (?, ?, ?)`)
          .bind(id, userId, text)
          .run();
        // Posting earns a little XP.
        await env.DB.prepare(`UPDATE users SET xp = xp + 5 WHERE id = ?`).bind(userId).run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason) VALUES (?, ?, 5, 'Shared a moment')`)
          .bind(newId("xp"), userId)
          .run();
        return j({ ok: true, id }, 201);
      }

      const likeMatch = path.match(/^\/api\/moments\/([^/]+)\/like$/);
      if (likeMatch) {
        const momentId = decodeURIComponent(likeMatch[1]);
        if (request.method === "POST") {
          const body = await readJson<{ user_id?: unknown }>(request);
          const userId = typeof body?.user_id === "string" ? body.user_id : "";
          if (!userId) return badRequest("user_id is required.");
          await env.DB.prepare(`INSERT OR IGNORE INTO moment_likes (moment_id, user_id) VALUES (?, ?)`)
            .bind(momentId, userId)
            .run();
          return j({ ok: true, liked: true });
        }
        if (request.method === "DELETE") {
          const userId = url.searchParams.get("user_id") ?? "";
          if (!userId) return badRequest("user_id is required.");
          await env.DB.prepare(`DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?`)
            .bind(momentId, userId)
            .run();
          return j({ ok: true, liked: false });
        }
      }

      // ---- Persistent daily check-in --------------------------------------------------------------
      if (path === "/api/checkin" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 100;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 500) {
          return badRequest("amount must be between 1 and 500.");
        }
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const ins = await env.DB.prepare(
          `INSERT OR IGNORE INTO checkins (user_id, day) VALUES (?, date('now'))`
        )
          .bind(userId)
          .run();
        const changed = (ins as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
        if (changed === 0) return conflict("Already checked in today. Come back tomorrow.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, xp = xp + 10, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'daily_reward', ?, 'Daily check-in')`
        )
          .bind(newId("tx"), userId, amount)
          .run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason) VALUES (?, ?, 10, 'Daily check-in')`)
          .bind(newId("xp"), userId)
          .run();
        const days = await env.DB.prepare(`SELECT day FROM checkins WHERE user_id = ? ORDER BY day DESC LIMIT 60`)
          .bind(userId)
          .all();
        let streak = 0;
        const cursor = new Date();
        for (const row of ((days.results ?? []) as Array<{ day: string }>)) {
          const expected = cursor.toISOString().slice(0, 10);
          if (row.day === expected) {
            streak++;
            cursor.setUTCDate(cursor.getUTCDate() - 1);
          } else break;
        }
        const balance = await env.DB.prepare(`SELECT coins, xp FROM users WHERE id = ?`).bind(userId).first();
        return j({ ok: true, credited: amount, streak, ...(balance as object | null) });
      }

      // ---- Sandbox coin recharge ----------------------------------------------------------------------
      if (path === "/api/recharge/packages" && request.method === "GET") {
        // Try D1 pricing_tiers first (10% cheaper), fall back to hardcoded 10% model
        try {
          const tiers = await env.DB.prepare(`SELECT tier, standard_coins, standard_price_cents, app_coins, app_price_cents, bonus_percent FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
          if (tiers.results && tiers.results.length > 0) {
return j({
          ok: true,
              note: "10% cheaper than market: same fiat price, 10% more coins. Sandbox top-up credits instantly.",
              market_baseline: "Standard: 25k/$5, 50k/$10, 100k/$20, 500k/$100",
              packages: (tiers.results as Array<Record<string, unknown>>).map((t) => ({
                id: t.tier as string,
                standard_coins: t.standard_coins,
                standard_price: `$${((t.standard_price_cents as number) / 100).toFixed(2)}`,
                coins: t.app_coins,
                price: `$${((t.app_price_cents as number) / 100).toFixed(2)}`,
                bonus: `${t.bonus_percent}% more`,
                value_note: `${t.app_coins} for $${((t.app_price_cents as number) / 100).toFixed(2)} vs ${t.standard_coins} market`,
              })),
              sandbox: [
                { id: "p60", coins: 60, price: "$0.99" },
                { id: "p300", coins: 300, price: "$4.99" },
              ],
            });
          }
        } catch {}
        return json({
          ok: true,
          note: "10% cheaper than market: pay same price, get 10% more coins. Sandbox top-up credits instantly.",
          packages: [
            { id: "starter", coins: 27500, standard_coins: 25000, price: "$5.00", bonus: "10% more", label: "Starter — 27,500 for $5 (vs 25k market)" },
            { id: "growth", coins: 55000, standard_coins: 50000, price: "$10.00", bonus: "10% more", label: "Growth — 55,000 for $10 (vs 50k)" },
            { id: "pro", coins: 110000, standard_coins: 100000, price: "$20.00", bonus: "10% more", label: "Pro — 110,000 for $20 (vs 100k)" },
            { id: "enterprise", coins: 550000, standard_coins: 500000, price: "$100.00", bonus: "10% more", label: "Enterprise — 550,000 for $100 (vs 500k)" },
            { id: "p60", coins: 60, price: "$0.99" },
            { id: "p300", coins: 300, price: "$4.99" },
          ],
        });
      }

      if (path === "/api/recharge/buy" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; package_id?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const packageId = typeof body?.package_id === "string" ? body.package_id : "";
        const packs: Record<string, number> = { starter: 27500, growth: 55000, pro: 110000, enterprise: 550000, p60: 60, p300: 300, p980: 980, p1980: 1980, p3280: 3280, p6480: 6480 };
        const coins = packs[packageId] ?? 0;
        if (!userId) return badRequest("user_id is required.");
        if (!coins) return badRequest("Unknown package.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(coins, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'purchase', ?, ?)`
        )
          .bind(newId("tx"), userId, coins, `Sandbox top-up ${packageId}`)
          .run();
        const balance = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return j({ ok: true, credited: coins, coins: (balance as Record<string, unknown> | null)?.coins ?? null });
      }

      // ---- Lucky spin --------------------------------------------------------------------------------------
      if (path === "/api/spin" && request.method === "POST") {
        const SPIN_COST = 20;
        const SEGMENTS = [0, 10, 30, 60, 150, 300];
        const WEIGHTS = [30, 30, 20, 12, 6, 2];
        const body = await readJson<{ user_id?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        if (!userId) return badRequest("user_id is required.");
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        if (((user as Record<string, unknown>).coins as number) < SPIN_COST) {
          return conflict("Not enough coins to spin (20 coins).");
        }
        const total = WEIGHTS.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        let prize = SEGMENTS[0];
        for (let i = 0; i < SEGMENTS.length; i++) {
          roll -= WEIGHTS[i];
          if (roll < 0) {
            prize = SEGMENTS[i];
            break;
          }
        }
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(prize - SPIN_COST, userId)
          .run();
        await env.DB.prepare(`INSERT INTO spin_plays (id, user_id, cost, prize) VALUES (?, ?, ?, ?)`)
          .bind(newId("spin"), userId, SPIN_COST, prize)
          .run();
        const balance = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return j({
          ok: true,
          cost: SPIN_COST,
          prize,
          net: prize - SPIN_COST,
          coins: (balance as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Leaderboards ---------------------------------------------------------------------------------------
      if (path === "/api/leaderboard" && request.method === "GET") {
        const type = url.searchParams.get("type") ?? "contributors";
        const period = url.searchParams.get("period") ?? "weekly";
        const cutoff =
          period === "daily" ? "datetime('now', 'start of day')" : period === "weekly" ? "datetime('now', '-7 days')" : null;
        if (type === "rooms") {
          const rooms = await env.DB.prepare(
            `SELECT r.id, r.slug, r.title, r.description, r.category, r.listener_count, r.speaker_count,
                    r.cover_color, u.display_name AS host_name
             FROM rooms r JOIN users u ON u.id = r.host_user_id
             WHERE r.status = 'live' ORDER BY r.listener_count DESC LIMIT 20`
          ).all();
          return j({ ok: true, type, period, rows: rooms.results ?? [] });
        }
        if (type === "hosts") {
          const hosts = await env.DB.prepare(
            `SELECT u.id, u.username, u.display_name, u.avatar_url, SUM(-t.amount) AS score
             FROM transactions t JOIN rooms r ON r.id = t.room_id JOIN users u ON u.id = r.host_user_id
             WHERE t.type = 'gift_sent'${cutoff ? ` AND t.created_at >= ${cutoff}` : ""}
             GROUP BY u.id ORDER BY score DESC LIMIT 20`
          ).all();
          return j({ ok: true, type, period, rows: hosts.results ?? [] });
        }
        const contributors = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url, SUM(-t.amount) AS score
           FROM transactions t JOIN users u ON u.id = t.user_id
           WHERE t.type = 'gift_sent'${cutoff ? ` AND t.created_at >= ${cutoff}` : ""}
           GROUP BY u.id ORDER BY score DESC LIMIT 20`
        ).all();
        return j({ ok: true, type: "contributors", period, rows: contributors.results ?? [] });
      }

      // ---- Search -------------------------------------------------------------------------------------------------
      if (path === "/api/search" && request.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
        const type = url.searchParams.get("type") ?? "all";
        if (q.length < 2) return j({ ok: true, rooms: [], users: [] });
        const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        let rooms: unknown[] = [];
        let users: unknown[] = [];
        if (type === "all" || type === "rooms") {
          const r = await env.DB.prepare(
            `SELECT r.id, r.slug, r.title, r.description, r.category, r.listener_count, r.speaker_count,
                    r.cover_color, u.display_name AS host_name
             FROM rooms r JOIN users u ON u.id = r.host_user_id
             WHERE r.status = 'live' AND (r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')
             ORDER BY r.listener_count DESC LIMIT 8`
          )
            .bind(like, like)
            .all();
          rooms = r.results ?? [];
        }
        if (type === "all" || type === "users") {
          const u = await env.DB.prepare(
            `SELECT id, username, display_name, avatar_url, coins, gems, xp, id_tag FROM users
             WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR id_tag LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' LIMIT 8`
          )
            .bind(like, like, like, like)
            .all();
          users = u.results ?? [];
        }
        return j({ ok: true, rooms, users });
      }

      // ---- Safety reports ----------------------------------------------------------------------------------------------
      if (path === "/api/reports" && request.method === "POST") {
        const body = await readJson<{ reporter_id?: unknown; target_id?: unknown; reason?: unknown; room_id?: unknown }>(
          request
        );
        const reporterId = typeof body?.reporter_id === "string" ? body.reporter_id : "";
        const targetId = typeof body?.target_id === "string" ? body.target_id : "";
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        if (!reporterId || !targetId) return badRequest("reporter_id and target_id are required.");
        if (reason.length < 2 || reason.length > 200) return badRequest("reason must be 2-200 characters.");
        for (const uid of [reporterId, targetId]) {
          const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
          if (!u) return notFound("User not found.");
        }
        const id = newId("report");
        await env.DB.prepare(
          `INSERT INTO reports (id, reporter_id, target_id, reason, room_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, reporterId, targetId, reason, roomId)
          .run();
        return j({ ok: true, id }, 201);
      }

      // ---- Cloudflare Realtime TURN (NAT traversal, Cloudflare-only) ------------
      // Primary: Realtime TURN API — POST rtc.live.cloudflare.com/v1/turn/keys/:id/credentials/generate-ice-servers
      // with Bearer TURN_API_TOKEN. Returns { iceServers: RTCIceServer[] } which we
      // forward verbatim (plus a flattened turn:{urls,username,credential} for old clients).
      // Fallback: legacy Calls turn_keys (CALLS_*), for accounts without a TURN key.
      if (path === "/api/turn" && request.method === "GET") {
        const { CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN, TURN_KEY_ID, TURN_API_TOKEN } = env;
        const hasRealtimeTurn =
          typeof TURN_KEY_ID === "string" && TURN_KEY_ID.length > 0 && !TURN_KEY_ID.startsWith("@") &&
          typeof TURN_API_TOKEN === "string" && TURN_API_TOKEN.length > 0 && !TURN_API_TOKEN.startsWith("@");
        const hasCallsTurn =
          typeof CALLS_ACCOUNT_ID === "string" && CALLS_ACCOUNT_ID.length > 0 && !CALLS_ACCOUNT_ID.startsWith("@") &&
          typeof CALLS_APP_ID === "string" && CALLS_APP_ID.length > 0 && !CALLS_APP_ID.startsWith("@") &&
          typeof CALLS_API_TOKEN === "string" && CALLS_API_TOKEN.length > 0 && !CALLS_API_TOKEN.startsWith("@");
        if (!hasRealtimeTurn && !hasCallsTurn) {
          return j({
          ok: true,
          configured: false,
          turn: null,
          iceServers: null,
          setup:
            "TURN not configured. Run: wrangler secret put TURN_KEY_ID, TURN_API_TOKEN (Realtime TURN) and CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN (SFU). Clients use local preview mic until then.",
        });
        }
        // 1) Preferred: Realtime TURN key (what you created as `bestaudio-turn`).
        if (hasRealtimeTurn) {
          try {
            const res = await fetch(
              `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${TURN_API_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ ttl: 86400 }),
              }
            );
            const payload = (await res.json()) as {
              iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
            };
            const iceServers = Array.isArray(payload.iceServers) ? payload.iceServers : null;
            if (!res.ok || !iceServers || iceServers.length === 0) {
              return j({ ok: false, configured: true, error: "TURN credential request failed.", detail: payload ?? null }, 502);
            }
            // Flatten TURN entry (with username/credential) for backwards-compat clients.
            const turnEntry = iceServers.find((s) => s.username && s.credential) ?? null;
            const urls = turnEntry ? (Array.isArray(turnEntry.urls) ? turnEntry.urls : [turnEntry.urls]) : [];
            return j({
              ok: true,
              configured: true,
              iceServers,
              turn:
                turnEntry != null
                  ? { urls, username: turnEntry.username as string, credential: turnEntry.credential as string }
                  : null,
            });
          } catch (err) {
            return j({ ok: false, configured: true, error: err instanceof Error ? err.message : "TURN error." }, 502);
          }
        }
        // 2) Legacy fallback: Calls turn_keys (deprecated, kept for compat).
        try {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CALLS_ACCOUNT_ID}/calls/turn_keys`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${CALLS_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ttl: 3600 }),
            }
          );
          const payload = (await res.json()) as {
            success?: boolean;
            result?: Record<string, unknown>;
            errors?: unknown;
          };
          const result = payload.result ?? {};
          const username = (result.username ?? result.uid ?? "") as string;
          const credential = (result.credential ?? result.password ?? "") as string;
          if (!res.ok || !payload.success || !username || !credential) {
            return j({ ok: false, configured: true, error: "TURN key request failed.", detail: payload.errors ?? null }, 502);
          }
          const urls = ["turn:turn.cloudflare.com:3478", "turns:turn.cloudflare.com:5349"];
          return j({
            ok: true,
            configured: true,
            iceServers: [{ urls }, { urls, username, credential }],
            turn: {
              urls,
              username,
              credential,
            },
          });
        } catch (err) {
          return j({ ok: false, configured: true, error: err instanceof Error ? err.message : "TURN error." }, 502);
        }
      }

      // ---- Cloudflare Calls SFU session broker ---------------------------------------
      if (path === "/api/calls/session" && request.method === "POST") {
        const { CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN } = env;
        const isPlaceholder = (v: unknown) => typeof v !== "string" || v.length === 0 || v.startsWith("@");
        if (isPlaceholder(CALLS_ACCOUNT_ID) || isPlaceholder(CALLS_APP_ID) || isPlaceholder(CALLS_API_TOKEN)) {
          return j(
            { ok: false, configured: false, error: "Calls not configured. Client should use preview mic mode." },
            501
          );
        }
        const body = await readJson<{ sdp?: unknown; room?: unknown }>(request);
        const sdp = typeof body?.sdp === "string" ? body.sdp : "";
        if (!sdp) return badRequest("sdp offer is required.");
        try {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CALLS_ACCOUNT_ID}/calls/apps/${CALLS_APP_ID}/sessions/new`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${CALLS_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sessionDescription: { sdp, type: "offer" } }),
            }
          );
          const payload = (await res.json()) as {
            success?: boolean;
            result?: { sessionId?: string; sessionDescription?: { sdp?: string } };
            errors?: unknown;
          };
          const answer = payload.result?.sessionDescription?.sdp;
          if (!res.ok || !payload.success || !answer) {
            return j({ ok: false, error: "Calls session failed.", detail: payload.errors ?? null }, 502);
          }
          return j({ ok: true, sessionId: payload.result?.sessionId ?? null, answer });
        } catch (err) {
          return j({ ok: false, error: err instanceof Error ? err.message : "Calls error." }, 502);
        }
      }

      // ==================== ADMIN PANEL & TRIPLE-CURRENCY ====================
      // RBAC: master_admin (full), finance (recharge only), support (tickets only)
      // Gems are host earnings at 70% of coin gift cost — see /api/gifts/send above

      async function ensureAdminTables() {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE)`).run(); } catch {}
      }
      async function getAdminFromToken(token: string): Promise<Record<string, unknown> | null> {
        if (!token || !token.startsWith("admin_")) return null;
        await ensureAdminTables();
        const sess = await env.DB.prepare(`SELECT * FROM admin_sessions WHERE id = ? AND expires_at > datetime('now')`).bind(token).first();
        if (!sess) return null;
        const adm = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind((sess as Record<string, unknown>).admin_id).first();
        return adm as Record<string, unknown> | null;
      }

      if (path === "/api/admin/login" && request.method === "POST") {
        const body = await readJson<{ username?: unknown; password?: unknown }>(request);
        const username = typeof body?.username === "string" ? body.username.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!username || !password) return badRequest("username and password required.");
        const admin = await env.DB.prepare(`SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE`).bind(username).first();
        if (!admin) return json({ ok: false, error: "Invalid credentials." }, 401);
        const row = admin as Record<string, unknown>;
        // Strict check only: SHA-256(password) must match the stored hash.
        // (The old "Admin123!" backdoor was removed; seeded placeholder
        // hashes are disabled. Master provisions team passwords explicitly.)
        const ok = (await sha256hex(password)) === (row.password_hash as string);
        if (!ok) return json({ ok: false, error: "Invalid credentials." }, 401);
        await ensureAdminTables();
        const token = `admin_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(`INSERT INTO admin_sessions (id, admin_id, role, expires_at) VALUES (?, ?, ?, datetime('now', '+12 hours'))`).bind(token, row.id, row.role).run();
        await env.DB.prepare(`UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`).bind(row.id).run();
        return j({ ok: true, admin: { id: row.id, username: row.username, display_name: row.display_name, role: row.role }, token });
      }

      if (path === "/api/admin/me" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Invalid admin session." }, 401);
        return j({ ok: true, admin: { id: adm.id, username: adm.username, display_name: adm.display_name, role: adm.role } });
      }

      // ---- Master bootstrap: THE admin signs in with Google, no password ----
      // Only the hardcoded master email can ever mint a master_admin session
      // this way. Everyone else gets 403, even with a valid Firebase token.
      if (path === "/api/admin/firebase" && request.method === "POST") {
        const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        if (!idToken) return json({ ok: false, error: "Missing Firebase ID token." }, 401);
        const verified = await verifyFirebaseIdToken(idToken);
        if (!verified) return json({ ok: false, error: "Invalid or expired Firebase ID token." }, 401);
        const email = (verified.email ?? "").trim().toLowerCase();
        if (!verified.emailVerified || verified.provider !== "google.com") {
          return json({ ok: false, error: "Master Admin requires a verified Google sign-in." }, 403);
        }
        if (!MASTER_ADMIN_EMAILS.includes(email)) {
          return json({ ok: false, error: "This Google account is not the game admin." }, 403);
        }
        await ensureAdminTables();
        let adm = await env.DB.prepare(
          `SELECT * FROM admin_users WHERE firebase_uid = ? OR username = 'marco'`
        )
          .bind(verified.uid)
          .first();
        if (!adm) {
          await env.DB.prepare(
            `INSERT INTO admin_users (id, username, display_name, role, password_hash, firebase_uid)
             VALUES ('admin-marco', 'marco', 'Marco (Owner)', 'master_admin', 'DISABLED-FIREBASE-ONLY', ?)`
          )
            .bind(verified.uid)
            .run();
          adm = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = 'admin-marco'`).first();
        } else {
          const row = adm as Record<string, unknown>;
          await env.DB.prepare(
            `UPDATE admin_users SET firebase_uid = ?, role = 'master_admin', last_login = CURRENT_TIMESTAMP WHERE id = ?`
          )
            .bind(verified.uid, row.id)
            .run();
          adm = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(row.id).first();
        }
        const row = adm as Record<string, unknown>;
        const token = `admin_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(
          `INSERT INTO admin_sessions (id, admin_id, role, expires_at) VALUES (?, ?, 'master_admin', datetime('now', '+12 hours'))`
        )
          .bind(token, row.id)
          .run();
        return j({
          ok: true,
          admin: { id: row.id, username: row.username, display_name: row.display_name, role: "master_admin" },
          token,
        });
      }

      // ---- Team management (master only) ----
      if (path === "/api/admin/team" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        const team = await env.DB.prepare(
          `SELECT id, username, display_name, role, firebase_uid, created_at, last_login FROM admin_users ORDER BY created_at ASC`
        ).all();
        return j({ ok: true, team: team.results ?? [] });
      }

      if (path === "/api/admin/team" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        const body = await readJson<{ username?: unknown; display_name?: unknown; role?: unknown; password?: unknown }>(request);
        const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
        const displayName = typeof body?.display_name === "string" ? body.display_name.trim().slice(0, 40) : "";
        const role = typeof body?.role === "string" ? body.role : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return badRequest("username must be 3-20 chars (a-z, 0-9, _ . -).");
        if (!displayName) return badRequest("display_name is required.");
        if (role !== "finance" && role !== "support") return badRequest("role must be finance or support.");
        if (password.length < 8 || password.length > 100) return badRequest("password must be 8-100 characters.");
        const exists = await env.DB.prepare(`SELECT id FROM admin_users WHERE username = ? COLLATE NOCASE`).bind(username).first();
        if (exists) return conflict("That admin username is taken.");
        const id = newId("admin");
        await env.DB.prepare(
          `INSERT INTO admin_users (id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, username, displayName, role, await sha256hex(password))
          .run();
        return j({ ok: true, id, username, role }, 201);
      }

      const teamDelMatch = path.match(/^\/api\/admin\/team\/([^/]+)$/);
      if (teamDelMatch && request.method === "DELETE") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        const id = decodeURIComponent(teamDelMatch[1]);
        if (id === adm.id) return badRequest("You cannot remove your own admin account.");
        const target = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind(id).first();
        if (!target) return notFound("Admin not found.");
        if ((target as Record<string, unknown>).role === "master_admin") {
          return j({ ok: false, error: "Master Admin accounts cannot be removed." }, 403);
        }
        await env.DB.prepare(`DELETE FROM admin_sessions WHERE admin_id = ?`).bind(id).run();
        await env.DB.prepare(`DELETE FROM admin_users WHERE id = ?`).bind(id).run();
        return j({ ok: true, removed: true });
      }

      // ---- Moderation: safety reports ----
      if (path === "/api/reports" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "support") {
          return json({ ok: false, error: "Support or Master Admin only." }, 403);
        }
        const status = url.searchParams.get("status") ?? "";
        const rows = status
          ? await env.DB.prepare(
              `SELECT r.*, ru.username AS reporter_name, tu.username AS target_name
               FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users tu ON tu.id = r.target_id
               WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 50`
            ).bind(status).all()
          : await env.DB.prepare(
              `SELECT r.*, ru.username AS reporter_name, tu.username AS target_name
               FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users tu ON tu.id = r.target_id
               ORDER BY r.created_at DESC LIMIT 50`
            ).all();
        return j({ ok: true, reports: rows.results ?? [] });
      }

      const reportPatchMatch = path.match(/^\/api\/reports\/([^/]+)$/);
      if (reportPatchMatch && request.method === "PATCH") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "support") {
          return json({ ok: false, error: "Support or Master Admin only." }, 403);
        }
        const body = await readJson<{ status?: unknown }>(request);
        const status = typeof body?.status === "string" ? body.status : "";
        if (status !== "reviewing" && status !== "resolved" && status !== "dismissed") {
          return badRequest("status must be reviewing, resolved or dismissed.");
        }
        await env.DB.prepare(`UPDATE reports SET status = ?, handled_by = ? WHERE id = ?`)
          .bind(status, adm.id, decodeURIComponent(reportPatchMatch[1]))
          .run();
        return j({ ok: true, status });
      }

      // ---- Moderation: end any live room ----
      if (path === "/api/admin/rooms/end" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "support") {
          return json({ ok: false, error: "Support or Master Admin only." }, 403);
        }
        const body = await readJson<{ slug?: unknown }>(request);
        const slug = typeof body?.slug === "string" ? body.slug : "";
        if (!slug) return badRequest("slug is required.");
        const room = await env.DB.prepare(`SELECT id, status FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        await env.DB.prepare(`UPDATE rooms SET status = 'ended', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind((room as Record<string, unknown>).id)
          .run();
        return j({ ok: true, ended: true });
      }

      // ---- Support ticket status ----
      const ticketStatusMatch = path.match(/^\/api\/support\/tickets\/([^/]+)$/);
      if (ticketStatusMatch && request.method === "PATCH") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "support") {
          return json({ ok: false, error: "Support or Master Admin only." }, 403);
        }
        const body = await readJson<{ status?: unknown }>(request);
        const status = typeof body?.status === "string" ? body.status : "";
        if (!["open", "pending", "resolved", "closed"].includes(status)) {
          return badRequest("Invalid status.");
        }
        await env.DB.prepare(
          `UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(status, decodeURIComponent(ticketStatusMatch[1]))
          .run();
        return json({ ok: true, status });
      }

      if (path === "/api/admin/recharge" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "finance") return json({ ok: false, error: "Finance or Master Admin only." }, 403);
        const body = await readJson<{ target_user_id?: unknown; action_type?: unknown; amount?: unknown; notes?: unknown }>(request);
        const targetId = typeof body?.target_user_id === "string" ? body.target_user_id : "";
        const action = typeof body?.action_type === "string" ? body.action_type : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 0;
        const notes = typeof body?.notes === "string" ? body.notes.slice(0, 300) : "";
        const allowed: Record<string, string> = { ADD_COINS: "coins", DEDUCT_COINS: "coins", ADD_GEMS: "gems", DEDUCT_GEMS: "gems", ADD_XP: "xp", DEDUCT_XP: "xp" };
        if (!targetId || !allowed[action]) return badRequest("target_user_id and valid action_type required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return badRequest("amount 1-1000000 required.");
        const user = await env.DB.prepare(`SELECT id, coins, gems, xp FROM users WHERE id = ?`).bind(targetId).first();
        if (!user) return notFound("Target user not found.");
        const col = allowed[action];
        const delta = action.startsWith("DEDUCT") ? -Math.abs(amount) : Math.abs(amount);
        // Prevent negative balances for coins/gems
        const row = user as Record<string, unknown>;
        if ((col === "coins" || col === "gems") && (row[col] as number) + delta < 0) return conflict(`Not enough ${col}.`);
        await env.DB.prepare(`UPDATE users SET ${col} = ${col} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(delta, targetId).run();
        await env.DB.prepare(`INSERT INTO admin_transactions (admin_id, target_user_id, action_type, amount, notes) VALUES (?, ?, ?, ?, ?)`).bind(adm.id, targetId, action, amount, notes).run();
        // Also log to transactions for user history
        const txType = col === "coins" ? (delta > 0 ? "purchase" : "refund") : col === "gems" ? (delta > 0 ? "gift_received" : "gift_sent") : "xp_boost";
        try { await env.DB.prepare(`INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)`).bind(newId("tx"), targetId, txType, delta, `Admin ${action} by ${adm.username}: ${notes}`).run(); } catch {}
        const updated = await env.DB.prepare(`SELECT coins, gems, xp FROM users WHERE id = ?`).bind(targetId).first();
        return j({ ok: true, target_user_id: targetId, action_type: action, amount, balance: updated });
      }

      if (path === "/api/admin/transactions" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50) || 50);
        const rows = await env.DB.prepare(`SELECT at.*, au.username as admin_username, u.username as target_username FROM admin_transactions at LEFT JOIN admin_users au ON au.id = at.admin_id LEFT JOIN users u ON u.id = at.target_user_id ORDER BY at.created_at DESC LIMIT ?`).bind(limit).all();
        return j({ ok: true, transactions: rows.results ?? [] });
      }

      if (path === "/api/admin/users" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        await ensureUserIdentityColumns();
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
        const like = `%${q}%`;
        const rows = q ? await env.DB.prepare(`SELECT id, username, display_name, id_tag, coins, gems, xp, email, phone, provider, banned, ban_reason, firebase_uid, created_at FROM users WHERE username LIKE ? OR display_name LIKE ? OR id_tag LIKE ? OR id = ? OR email LIKE ? OR phone LIKE ? LIMIT 10`).bind(like, like, like, q, like, like).all() : await env.DB.prepare(`SELECT id, username, display_name, id_tag, coins, gems, xp, email, phone, provider, banned, ban_reason, firebase_uid, created_at FROM users ORDER BY updated_at DESC LIMIT 10`).all();
        return j({ ok: true, users: rows.results ?? [] });
      }

      // ---- User moderation: ban / unban (master_admin only). Banning wipes
      // all live sessions immediately; enforcement lives in /api/auth/me and
      // /api/auth/firebase so banned users can't re-mint.
      if (path === "/api/admin/users/ban" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        await ensureUserIdentityColumns();
        const body = await readJson<{ user_id?: unknown; banned?: unknown; reason?: unknown }>(request);
        const key = typeof body?.user_id === "string" ? body.user_id.trim() : "";
        const banned = body?.banned === true;
        const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : "";
        if (!key) return badRequest("user_id (id, username, or id_tag) is required.");
        const target = await resolveUser(key);
        if (!target) return notFound("User not found.");
        const targetId = (target as Record<string, unknown>).id as string;
        await env.DB.prepare(`UPDATE users SET banned = ?, ban_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(banned ? 1 : 0, banned ? reason : null, targetId)
          .run();
        if (banned) {
          try {
            await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(targetId).run();
          } catch {}
        }
        return j({ ok: true, user_id: targetId, banned });
      }

      // ---- Upgrade an app user to the admin team (master_admin only).
      // Creates an admin_users row (support/finance). Login works via their
      // linked Firebase Google identity; if they have none, the master sets
      // an initial password instead (stored hashed, like team accounts).
      if (path === "/api/admin/users/promote" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        await ensureUserIdentityColumns();
        const body = await readJson<{ user_id?: unknown; role?: unknown; password?: unknown }>(request);
        const key = typeof body?.user_id === "string" ? body.user_id.trim() : "";
        const role = typeof body?.role === "string" ? body.role : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!key) return badRequest("user_id (id, username, or id_tag) is required.");
        if (role !== "support" && role !== "finance") return badRequest("role must be support or finance.");
        const target = await resolveUser(key);
        if (!target) return notFound("User not found.");
        const t = target as Record<string, unknown>;
        const adminUsername = ((t.username as string) || `user_${(t.id as string).slice(0, 8)}`).toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 20) || `user_${(t.id as string).slice(-6)}`;
        const dupe = await env.DB.prepare(`SELECT id FROM admin_users WHERE username = ? COLLATE NOCASE`).bind(adminUsername).first();
        if (dupe) return conflict("An admin account with that username already exists.");
        const firebaseUid = (t.firebase_uid as string) || null;
        let passwordHash = "DISABLED-FIREBASE-ONLY";
        if (!firebaseUid) {
          if (password.length < 8 || password.length > 100) {
            return badRequest("This user has no Google identity linked — set an initial password (8-100 chars).");
          }
          passwordHash = await sha256hex(password);
        } else if (password) {
          if (password.length < 8 || password.length > 100) return badRequest("password must be 8-100 characters.");
          passwordHash = await sha256hex(password);
        }
        const adminId = newId("admin");
        await env.DB.prepare(
          `INSERT INTO admin_users (id, username, display_name, role, password_hash, firebase_uid) VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(adminId, adminUsername, ((t.display_name as string) || (t.username as string) || adminUsername).slice(0, 40), role, passwordHash, firebaseUid)
          .run();
        return j({ ok: true, admin_id: adminId, admin_username: adminUsername, role, firebase_login: !!firebaseUid }, 201);
      }

      if (path === "/api/admin/stats" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        const stats = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM rooms WHERE status='live') as live_rooms, (SELECT COALESCE(SUM(coins),0) FROM users) as total_coins, (SELECT COALESCE(SUM(gems),0) FROM users) as total_gems, (SELECT COUNT(*) FROM support_tickets WHERE status='open') as open_tickets, (SELECT COUNT(*) FROM admin_transactions) as recharge_ops`).first();
        const tiers = await env.DB.prepare(`SELECT * FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
        return j({ ok: true, stats, pricing: tiers.results ?? [] });
      }

      if (path === "/api/support/tickets" && request.method === "GET") {
        const userId = url.searchParams.get("user_id") ?? "";
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = token ? await getAdminFromToken(token) : null;
        if (adm && ((adm.role as string) === "support" || (adm.role as string) === "master_admin")) {
          const status = url.searchParams.get("status") ?? "";
          const rows = status ? await env.DB.prepare(`SELECT * FROM support_tickets WHERE status = ? ORDER BY updated_at DESC LIMIT 50`).bind(status).all() : await env.DB.prepare(`SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 50`).all();
return j({ ok: true, tickets: rows.results ?? [] });
        }
        if (!userId) return badRequest("user_id or admin token required.");
        const rows = await env.DB.prepare(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`).bind(userId).all();
        return j({ ok: true, tickets: rows.results ?? [] });
      }

      if (path === "/api/support/tickets" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; subject?: unknown; category?: unknown; message?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";
        const category = typeof body?.category === "string" ? body.category : "other";
        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!userId || !subject || !message) return badRequest("user_id, subject, message required.");
        if (!["recharge","account","technical","moderation","other"].includes(category)) return badRequest("Invalid category.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const id = newId("ticket");
        await env.DB.prepare(`INSERT INTO support_tickets (id, user_id, subject, category, message) VALUES (?, ?, ?, ?, ?)`).bind(id, userId, subject, category, message).run();
        return j({ ok: true, id }, 201);
      }

      if (path.match(/^\/api\/support\/tickets\/[^/]+\/reply$/) && request.method === "POST") {
        const ticketId = path.split("/")[3];
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        const body = await readJson<{ message?: unknown; user_id?: unknown }>(request);
        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!message) return badRequest("message required.");
        const ticket = await env.DB.prepare(`SELECT * FROM support_tickets WHERE id = ?`).bind(ticketId).first();
        if (!ticket) return notFound("Ticket not found.");
        if (adm) {
          await env.DB.prepare(`INSERT INTO ticket_replies (id, ticket_id, author_admin_id, message) VALUES (?, ?, ?, ?)`).bind(newId("reply"), ticketId, adm.id, message).run();
          await env.DB.prepare(`UPDATE support_tickets SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ticketId).run();
return j({ ok: true });
        }
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        if (!userId || (ticket as Record<string, unknown>).user_id !== userId) return json({ ok: false, error: "Not ticket owner." }, 403);
        await env.DB.prepare(`INSERT INTO ticket_replies (id, ticket_id, author_user_id, message) VALUES (?, ?, ?, ?)`).bind(newId("reply"), ticketId, userId, message).run();
        await env.DB.prepare(`UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ticketId).run();
        return j({ ok: true });
      }

      if (path.match(/^\/api\/support\/tickets\/[^/]+$/) && request.method === "GET") {
        const ticketId = path.split("/")[3];
        const ticket = await env.DB.prepare(`SELECT * FROM support_tickets WHERE id = ?`).bind(ticketId).first();
        if (!ticket) return notFound("Ticket not found.");
        const replies = await env.DB.prepare(`SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC`).bind(ticketId).all();
        // Enrich with quick lookup links
        const user = await env.DB.prepare(`SELECT id, username, coins, gems, xp FROM users WHERE id = ?`).bind((ticket as Record<string, unknown>).user_id).first();
        return j({ ok: true, ticket, replies: replies.results ?? [], user });
      }

      if (path === "/api/pricing" && request.method === "GET") {
        const tiers = await env.DB.prepare(`SELECT * FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
        return j({ ok: true, tiers: tiers.results ?? [] });
      }

      // ---- Private Call: Accept/Reject/End/Status --------------------------------------------------
      if (path === "/api/rooms/private-call/accept" && request.method === "POST") {
        const body = await readJson<{ room_id?: unknown }>(request);
        const roomId = typeof body?.room_id === "string" ? body.room_id : "";
        if (!roomId) return badRequest("room_id is required.");

        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);

        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ? AND is_private = 1 AND status = 'live'`).bind(roomId).first();
        if (!room) return notFound("Private call room not found or not active.");
        const roomRow = room as Record<string, unknown>;

        // Verify user is the callee
        if (roomRow.call_participant_user_id !== userId) {
          return j({ ok: false, error: "Not authorized to accept this call." }, 403);
        }

        // Update room status and call session
        await env.DB.prepare(`UPDATE rooms SET status = 'live', call_started_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(roomId).run();
        await env.DB.prepare(`UPDATE private_call_sessions SET status = 'connected', connected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE room_id = ?`).bind(roomId).run();
        const sess = await env.DB.prepare(`SELECT s.*, r.slug AS room_slug FROM private_call_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.room_id = ?`).bind(roomId).first();

        return j({ ok: true, message: "Call accepted", room_slug: (sess as Record<string, unknown> | null)?.room_slug ?? null, media: (sess as Record<string, unknown> | null)?.media ?? "audio" });
      }

      if (path === "/api/rooms/private-call/reject" && request.method === "POST") {
        const body = await readJson<{ room_id?: unknown }>(request);
        const roomId = typeof body?.room_id === "string" ? body.room_id : "";
        if (!roomId) return badRequest("room_id is required.");

        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ? AND is_private = 1`).bind(roomId).first();
        if (!room) return notFound("Private call room not found.");
        const roomRow = room as Record<string, unknown>;

        // Verify user is the callee
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        if (roomRow.call_participant_user_id !== userId) {
          return j({ ok: false, error: "Not authorized to reject this call." }, 403);
        }

        // End the call
        await env.DB.prepare(`UPDATE rooms SET status = 'ended', call_ended_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(roomId).run();
        await env.DB.prepare(`UPDATE private_call_sessions SET status = 'rejected', ended_at = CURRENT_TIMESTAMP WHERE room_id = ?`).bind(roomId).run();

        return j({ ok: true, message: "Call rejected" });
      }

      if (path === "/api/rooms/private-call/end" && request.method === "POST") {
        const body = await readJson<{ room_id?: unknown }>(request);
        const roomId = typeof body?.room_id === "string" ? body.room_id : "";
        if (!roomId) return badRequest("room_id is required.");

        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ? AND is_private = 1`).bind(roomId).first();
        if (!room) return notFound("Private call room not found.");
        const roomRow = room as Record<string, unknown>;

        // Verify user is either caller or callee
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        if (roomRow.host_user_id !== userId && roomRow.call_participant_user_id !== userId) {
          return j({ ok: false, error: "Not authorized to end this call." }, 403);
        }

        // End the call
        await env.DB.prepare(`UPDATE rooms SET status = 'ended', call_ended_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(roomId).run();
        await env.DB.prepare(`UPDATE private_call_sessions SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE room_id = ?`).bind(roomId).run();

        return j({ ok: true, message: "Call ended" });
      }

      if (path === "/api/rooms/private-call/status" && request.method === "GET") {
        const roomId = url.searchParams.get("room_id") || "";
        if (!roomId) return badRequest("room_id is required.");

        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ? AND is_private = 1`).bind(roomId).first();
        if (!room) return notFound("Private call room not found.");

        const callSession = await env.DB.prepare(`SELECT * FROM private_call_sessions WHERE room_id = ?`).bind(roomId).first();
        const caller = room.host_user_id ? await env.DB.prepare(`SELECT id, display_name, avatar_url FROM users WHERE id = ?`).bind((room as Record<string, unknown>).host_user_id).first() : null;
        const callee = (room as Record<string, unknown>).call_participant_user_id ? await env.DB.prepare(`SELECT id, display_name, avatar_url FROM users WHERE id = ?`).bind((room as Record<string, unknown>).call_participant_user_id).first() : null;

        return j({ ok: true, room, call_session: callSession, caller, callee });
      }

      // Session user for call endpoints. Guards the missing-cookie case BEFORE
      // binding (D1 throws D1_TYPE_ERROR on undefined bind values).
      async function sessionUserId(): Promise<string | null> {
        const cookieToken = (request.headers.get("Cookie") || "").split("; ").find((c) => c.trim().startsWith("session="))?.split("=")[1];
        if (!cookieToken) return null;
        const s = await env.DB.prepare(`SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`).bind(cookieToken).first();
        return ((s as Record<string, unknown> | null)?.user_id as string) ?? null;
      }

      // Caller hangs up while still ringing → callee stops ringing (cancelled).
      if (path === "/api/rooms/private-call/cancel" && request.method === "POST") {
        const body = await readJson<{ room_id?: unknown }>(request);
        const roomId = typeof body?.room_id === "string" ? body.room_id : "";
        if (!roomId) return badRequest("room_id is required.");
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ? AND is_private = 1`).bind(roomId).first();
        if (!room) return notFound("Private call room not found.");
        if ((room as Record<string, unknown>).host_user_id !== userId) {
          return j({ ok: false, error: "Only the caller can cancel." }, 403);
        }
        await env.DB.prepare(`UPDATE private_call_sessions SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND status IN ('initiated', 'ringing')`).bind(roomId).run();
        await env.DB.prepare(`UPDATE rooms SET status = 'ended', call_ended_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(roomId).run();
        return j({ ok: true, message: "Call cancelled" });
      }

      // Callee lets it ring out (or app timeout) → missed call for the recents log.
      if (path === "/api/rooms/private-call/missed" && request.method === "POST") {
        const body = await readJson<{ room_id?: unknown }>(request);
        const roomId = typeof body?.room_id === "string" ? body.room_id : "";
        if (!roomId) return badRequest("room_id is required.");
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        const room = await env.DB.prepare(`SELECT host_user_id, call_participant_user_id FROM rooms WHERE id = ? AND is_private = 1`).bind(roomId).first();
        if (!room) return notFound("Private call room not found.");
        const rr = room as Record<string, unknown>;
        if (rr.host_user_id !== userId && rr.call_participant_user_id !== userId) {
          return j({ ok: false, error: "Not part of this call." }, 403);
        }
        await env.DB.prepare(`UPDATE private_call_sessions SET status = 'missed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND status IN ('initiated', 'ringing')`).bind(roomId).run();
        await env.DB.prepare(`UPDATE rooms SET status = 'ended', call_ended_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(roomId).run();
        return j({ ok: true, message: "Marked missed" });
      }

      // ---- Calls tab (recents, incoming ringing, missed badge) ---------------------------
      // Shared rule: stale ringing (>75s, nobody picked up) expires to 'missed'
      // so neither side rings forever and recents stay truthful.
      async function expireStaleRinging(): Promise<void> {
        try {
          const stale = await env.DB.prepare(
            `SELECT room_id FROM private_call_sessions
             WHERE status IN ('initiated', 'ringing') AND created_at < datetime('now', '-75 seconds') LIMIT 20`
          ).all();
          for (const r of ((stale.results ?? []) as Array<Record<string, unknown>>)) {
            await env.DB.prepare(`UPDATE private_call_sessions SET status = 'missed', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE room_id = ? AND status IN ('initiated', 'ringing')`).bind(r.room_id).run();
            await env.DB.prepare(`UPDATE rooms SET status = 'ended', call_ended_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'live'`).bind(r.room_id).run();
          }
        } catch { /* expiry is best-effort */ }
      }

      // Recents: every call I'm part of, newest first, with both peers.
      if (path === "/api/calls" && request.method === "GET") {
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        await expireStaleRinging();
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
        const rows = await env.DB.prepare(
          `SELECT s.id, s.room_id, s.caller_user_id, s.callee_user_id, s.price_per_minute,
                  s.status, s.media, s.started_at, s.connected_at, s.ended_at, s.created_at,
                  r.slug AS room_slug,
                  c.username AS caller_username, c.display_name AS caller_name, c.avatar_url AS caller_avatar,
                  e.username AS callee_username, e.display_name AS callee_name, e.avatar_url AS callee_avatar
           FROM private_call_sessions s
           JOIN rooms r ON r.id = s.room_id
           JOIN users c ON c.id = s.caller_user_id
           JOIN users e ON e.id = s.callee_user_id
           WHERE s.caller_user_id = ? OR s.callee_user_id = ?
           ORDER BY s.created_at DESC LIMIT ?`
        ).bind(userId, userId, limit).all();
        const calls = ((rows.results ?? []) as Array<Record<string, unknown>>).map((s) => ({
          id: s.id,
          room_id: s.room_id,
          room_slug: s.room_slug,
          direction: s.caller_user_id === userId ? "out" : "in",
          status: s.status,
          media: s.media ?? "audio",
          price_per_minute: s.price_per_minute,
          started_at: s.started_at,
          connected_at: s.connected_at,
          ended_at: s.ended_at,
          created_at: s.created_at,
          peer: s.caller_user_id === userId
            ? { id: s.callee_user_id, username: s.callee_username, display_name: s.callee_name, avatar_url: s.callee_avatar }
            : { id: s.caller_user_id, username: s.caller_username, display_name: s.caller_name, avatar_url: s.caller_avatar },
        }));
        return j({ ok: true, calls });
      }

      // Ringing right now where I'm the callee — polled by the global incoming-call UI.
      if (path === "/api/calls/incoming" && request.method === "GET") {
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        await expireStaleRinging();
        const rows = await env.DB.prepare(
          `SELECT s.id, s.room_id, s.media, s.created_at, r.slug AS room_slug,
                  c.id AS caller_id, c.username AS caller_username, c.display_name AS caller_name, c.avatar_url AS caller_avatar
           FROM private_call_sessions s
           JOIN rooms r ON r.id = s.room_id
           JOIN users c ON c.id = s.caller_user_id
           WHERE s.callee_user_id = ? AND s.status IN ('initiated', 'ringing') AND r.status = 'live'
           ORDER BY s.created_at DESC LIMIT 5`
        ).bind(userId).all();
        const incoming = ((rows.results ?? []) as Array<Record<string, unknown>>).map((s) => ({
          id: s.id,
          room_id: s.room_id,
          room_slug: s.room_slug,
          media: s.media ?? "audio",
          created_at: s.created_at,
          caller: { id: s.caller_id, username: s.caller_username, display_name: s.caller_name, avatar_url: s.caller_avatar },
        }));
        return j({ ok: true, incoming });
      }

      // Missed-call badge count (resets when the Calls tab is opened).
      if (path === "/api/calls/missed-count" && request.method === "GET") {
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        await expireStaleRinging();
        try {
          await env.DB.prepare(`ALTER TABLE users ADD COLUMN last_calls_seen TEXT`).run();
        } catch { /* exists */ }
        const row = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM private_call_sessions
           WHERE callee_user_id = ? AND status = 'missed'
             AND created_at > COALESCE((SELECT last_calls_seen FROM users WHERE id = ?), '1970-01-01')`
        ).bind(userId, userId).first();
        return j({ ok: true, missed: Number((row as Record<string, unknown> | null)?.n ?? 0) });
      }

      // Opening the Calls tab clears the missed badge.
      if (path === "/api/calls/seen" && request.method === "POST") {
        const userId = await sessionUserId();
        if (!userId) return j({ ok: false, error: "Invalid or expired session." }, 401);
        try {
          await env.DB.prepare(`ALTER TABLE users ADD COLUMN last_calls_seen TEXT`).run();
        } catch { /* exists */ }
        await env.DB.prepare(`UPDATE users SET last_calls_seen = CURRENT_TIMESTAMP WHERE id = ?`).bind(userId).run();
        return j({ ok: true });
      }

      // ---- Chat / Direct Messaging -------------------------------------------
      // Privacy note: DMs are stored server-side in D1 (needed for multi-device
      // sync + moderation). This is NOT end-to-end encrypted: the server can
      // read message content. Never advertise E2EE for this path.
      async function requireChatUser(): Promise<string | null> {
        const cookieToken = (request.headers.get("Cookie") || "").split("; ").find((c) => c.trim().startsWith("session="))?.split("=")[1];
        if (!cookieToken) return null;
        const s = await env.DB.prepare(`SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`).bind(cookieToken).first();
        return ((s as Record<string, unknown> | null)?.user_id as string) ?? null;
      }
      async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
        const m = await env.DB.prepare(`SELECT 1 AS x FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).bind(conversationId, userId).first();
        return !!m;
      }
      async function hydrateConversation(conversationId: string, viewerId: string) {
        const conversation = await env.DB.prepare(`SELECT * FROM conversations WHERE id = ?`).bind(conversationId).first();
        if (!conversation) return null;
        const parts = await env.DB.prepare(
          `SELECT cp.user_id, cp.joined_at, cp.last_read_at, cp.muted, u.username, u.display_name, u.avatar_url
           FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? ORDER BY cp.joined_at ASC`
        ).bind(conversationId).all();
        const participants = ((parts.results ?? []) as Array<Record<string, unknown>>).map((p) => {
          const row = p as Record<string, unknown>;
          return {
            user_id: row.user_id,
            joined_at: row.joined_at,
            last_read_at: row.last_read_at,
            muted: row.muted,
            user: { id: row.user_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url },
          };
        });
        const last = await env.DB.prepare(
          `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = ? AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1`
        ).bind(conversationId).first();
        const me = ((parts.results ?? []) as Array<Record<string, unknown>>).find((p) => p.user_id === viewerId);
        let unread_count = 0;
        if (me?.last_read_at) {
          const c = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL AND created_at > ?`
          ).bind(conversationId, viewerId, me.last_read_at as string).first();
          unread_count = Number((c as Record<string, unknown> | null)?.n ?? 0);
        } else {
          const c = await env.DB.prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL`
          ).bind(conversationId, viewerId).first();
          unread_count = Math.min(100, Number((c as Record<string, unknown> | null)?.n ?? 0));
        }
        let last_message = null;
        if (last) {
          const l = last as Record<string, unknown>;
          last_message = {
            id: l.id, conversation_id: l.conversation_id, sender_id: l.sender_id,
            content: l.content, type: l.type, reply_to_id: l.reply_to_id, metadata: l.metadata,
            created_at: l.created_at, updated_at: l.updated_at, deleted_at: l.deleted_at,
            sender: { id: l.sender_id, username: l.username, display_name: l.display_name, avatar_url: l.avatar_url },
          };
        }
        return { ...(conversation as object), participants, last_message, unread_count };
      }

      if (path === "/api/conversations/unread-count" && request.method === "GET") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const rows = await env.DB.prepare(
          `SELECT cp.conversation_id, cp.last_read_at FROM conversation_participants cp WHERE cp.user_id = ?`
        ).bind(userId).all();
        let unread_count = 0;
        for (const r of ((rows.results ?? []) as Array<Record<string, unknown>>)) {
          if (r.last_read_at) {
            const c = await env.DB.prepare(
              `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL AND created_at > ?`
            ).bind(r.conversation_id, userId, r.last_read_at as string).first();
            unread_count += Number((c as Record<string, unknown> | null)?.n ?? 0);
          } else {
            const c = await env.DB.prepare(
              `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND sender_id != ? AND deleted_at IS NULL`
            ).bind(r.conversation_id, userId).first();
            unread_count += Math.min(100, Number((c as Record<string, unknown> | null)?.n ?? 0));
          }
        }
        return j({ ok: true, unread_count });
      }

      if (path === "/api/conversations/direct" && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const body = await readJson<{ other_user_id?: unknown }>(request);
        const otherId = typeof body?.other_user_id === "string" ? body.other_user_id : "";
        if (!otherId) return badRequest("other_user_id is required.");
        if (otherId === userId) return badRequest("Cannot message yourself.");
        const other = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(otherId).first();
        if (!other) return notFound("User not found.");
        const existing = await env.DB.prepare(
          `SELECT c.id FROM conversations c
           JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = ?
           JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = ?
           WHERE c.type = 'direct'`
        ).bind(userId, otherId).first();
        if (existing) {
          const full = await hydrateConversation((existing as Record<string, unknown>).id as string, userId);
          return j({ ok: true, conversation: full });
        }
        const id = newId("conv");
        await env.DB.prepare(`INSERT INTO conversations (id, type, created_by) VALUES (?, 'direct', ?)`).bind(id, userId).run();
        await env.DB.prepare(`INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)`).bind(id, userId, id, otherId).run();
        const full = await hydrateConversation(id, userId);
        return j({ ok: true, conversation: full }, 201);
      }

      if (path === "/api/conversations" && request.method === "GET") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const rows = await env.DB.prepare(
          `SELECT c.* FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id
           WHERE cp.user_id = ? ORDER BY c.updated_at DESC LIMIT 50`
        ).bind(userId).all();
        const out = [];
        for (const r of ((rows.results ?? []) as Array<Record<string, unknown>>)) {
          out.push(await hydrateConversation(r.id as string, userId));
        }
        return j({ ok: true, conversations: out });
      }

      if (path === "/api/conversations" && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const body = await readJson<{ type?: unknown; room_id?: unknown; participant_ids?: unknown }>(request);
        const type = body?.type === "room" ? "room" : "group";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        const ids = Array.isArray(body?.participant_ids) ? (body.participant_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
        const unique = [...new Set([userId, ...ids])].slice(0, 20);
        if (unique.length < 2) return badRequest("At least one other participant is required.");
        const id = newId("conv");
        await env.DB.prepare(`INSERT INTO conversations (id, type, room_id, created_by) VALUES (?, ?, ?, ?)`).bind(id, type, roomId, userId).run();
        for (const pid of unique) {
          const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(pid).first();
          if (u) await env.DB.prepare(`INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)`).bind(id, pid).run();
        }
        const full = await hydrateConversation(id, userId);
        return j({ ok: true, conversation: full }, 201);
      }

      const convIdMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
      if (convIdMatch && request.method === "GET") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const cid = decodeURIComponent(convIdMatch[1]);
        if (!(await isConversationMember(cid, userId))) return j({ ok: false, error: "Not a participant." }, 403);
        const full = await hydrateConversation(cid, userId);
        if (!full) return notFound("Conversation not found.");
        return j({ ok: true, conversation: full });
      }

      const convMsgMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (convMsgMatch) {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const cid = decodeURIComponent(convMsgMatch[1]);
        if (!(await isConversationMember(cid, userId))) return j({ ok: false, error: "Not a participant." }, 403);
        if (request.method === "GET") {
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
          const before = url.searchParams.get("before");
          const rows = before
            ? await env.DB.prepare(
                `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.conversation_id = ? AND m.deleted_at IS NULL AND m.created_at < ?
                 ORDER BY m.created_at DESC LIMIT ?`
              ).bind(cid, before, limit).all()
            : await env.DB.prepare(
                `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m
                 JOIN users u ON u.id = m.sender_id
                 WHERE m.conversation_id = ? AND m.deleted_at IS NULL
                 ORDER BY m.created_at DESC LIMIT ?`
              ).bind(cid, limit).all();
          const messages = ((rows.results ?? []) as Array<Record<string, unknown>>).reverse().map((m) => ({
            id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
            content: m.content, type: m.type, reply_to_id: m.reply_to_id, metadata: m.metadata,
            created_at: m.created_at, updated_at: m.updated_at, deleted_at: m.deleted_at,
            sender: { id: m.sender_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url },
          }));
          return j({ ok: true, messages });
        }
        if (request.method === "POST") {
          const contentType = request.headers.get("content-type") || "";
          let content = "";
          let type = "text";
          let replyTo = null;
          let attachmentIds: string[] = [];

          if (contentType.includes("multipart/form-data")) {
            const formData = await request.formData();
            const contentEntry = formData.get("content");
            content = typeof contentEntry === "string" ? contentEntry.trim() : "";
            const typeEntry = formData.get("type");
            type = typeof typeEntry === "string" ? typeEntry : "text";
            const replyToEntry = formData.get("reply_to_id");
            replyTo = typeof replyToEntry === "string" ? replyToEntry : null;
            // Handle attachment_ids from form data
            const attachmentIdsStr = formData.get("attachment_ids") as string | null;
            if (attachmentIdsStr) {
              try { attachmentIds = JSON.parse(attachmentIdsStr); } catch { attachmentIds = []; }
            }
          } else {
            const body = await readJson<{ content?: unknown; type?: unknown; reply_to_id?: unknown; attachment_ids?: unknown }>(request);
            content = typeof body?.content === "string" ? body.content.trim() : "";
            type = body?.type === "image" || body?.type === "audio" || body?.type === "file" ? (body.type as string) : "text";
            replyTo = typeof body?.reply_to_id === "string" && body.reply_to_id ? body.reply_to_id : null;
            attachmentIds = Array.isArray(body?.attachment_ids) ? body.attachment_ids : [];
          }

          if (!content && attachmentIds.length === 0) return badRequest("content or attachments required.");
          if (content && content.length > 2000) return badRequest("content must be 1-2000 characters.");
          
          const id = newId("msg");
          await env.DB.prepare(
            `INSERT INTO messages (id, conversation_id, sender_id, content, type, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(id, cid, userId, content, type, replyTo).run();

          // Link attachments to message
          if (attachmentIds.length > 0) {
            for (const attachmentId of attachmentIds) {
              await env.DB.prepare(
                `UPDATE message_attachments SET message_id = ? WHERE id = ? AND message_id IS NULL`
              ).bind(id, attachmentId).run();
            }
          }

          await env.DB.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(cid).run();
          await env.DB.prepare(`UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?`).bind(cid, userId).run();
          try {
            await env.DB.prepare(`UPDATE users SET xp = xp + 1 WHERE id = ?`).bind(userId).run();
            await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason) VALUES (?, ?, 1, 'Sent a message')`).bind(newId("xp"), userId).run();
          } catch { /* xp is best-effort */ }
          const row = await env.DB.prepare(
            `SELECT m.*, u.username, u.display_name, u.avatar_url FROM messages m
             JOIN users u ON u.id = m.sender_id WHERE m.id = ?`
          ).bind(id).first();
          const m = row as Record<string, unknown>;
          const attachments = await env.DB.prepare(
            `SELECT * FROM message_attachments WHERE message_id = ?`
          ).bind(id).all();
          return j({ ok: true, message: {
            id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id,
            content: m.content, type: m.type, reply_to_id: m.reply_to_id, metadata: m.metadata,
            created_at: m.created_at, updated_at: m.updated_at, deleted_at: m.deleted_at,
            sender: { id: m.sender_id, username: m.username, display_name: m.display_name, avatar_url: m.avatar_url },
            attachments: attachments.results ?? []
          } }, 201);
        }
        return notFound();
      }

      const convPartsMatch = path.match(/^\/api\/conversations\/([^/]+)\/participants$/);
      if (convPartsMatch && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const cid = decodeURIComponent(convPartsMatch[1]);
        if (!(await isConversationMember(cid, userId))) return j({ ok: false, error: "Not a participant." }, 403);
        const body = await readJson<{ user_id?: unknown }>(request);
        const pid = typeof body?.user_id === "string" ? body.user_id : "";
        if (!pid) return badRequest("user_id is required.");
        const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(pid).first();
        if (!u) return notFound("User not found.");
        await env.DB.prepare(`INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)`).bind(cid, pid).run();
        return j({ ok: true });
      }

      const convPartOneMatch = path.match(/^\/api\/conversations\/([^/]+)\/participants\/([^/]+)$/);
      if (convPartOneMatch && request.method === "DELETE") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const cid = decodeURIComponent(convPartOneMatch[1]);
        const pid = decodeURIComponent(convPartOneMatch[2]);
        if (!(await isConversationMember(cid, userId))) return j({ ok: false, error: "Not a participant." }, 403);
        if (pid !== userId) {
          const conv = await env.DB.prepare(`SELECT created_by FROM conversations WHERE id = ?`).bind(cid).first();
          if ((conv as Record<string, unknown> | null)?.created_by !== userId) {
            return j({ ok: false, error: "Only the creator can remove others." }, 403);
          }
        }
        await env.DB.prepare(`DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?`).bind(cid, pid).run();
        return j({ ok: true });
      }

      if (path.match(/^\/api\/conversations\/[^/]+\/read$/) && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const cid = decodeURIComponent(path.split("/")[3]);
        if (!(await isConversationMember(cid, userId))) return j({ ok: false, error: "Not a participant." }, 403);
        await env.DB.prepare(`UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP WHERE conversation_id = ? AND user_id = ?`).bind(cid, userId).run();
        return j({ ok: true });
      }

      const msgOneMatch = path.match(/^\/api\/messages\/([^/]+)$/);
      if (msgOneMatch) {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        const mid = decodeURIComponent(msgOneMatch[1]);
        const msg = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(mid).first();
        if (!msg) return notFound("Message not found.");
        if ((msg as Record<string, unknown>).sender_id !== userId) {
          return j({ ok: false, error: "Only the sender can edit or delete." }, 403);
        }
        if (request.method === "PATCH") {
          const body = await readJson<{ content?: unknown }>(request);
          const content = typeof body?.content === "string" ? body.content.trim() : "";
          if (!content || content.length > 2000) return badRequest("content must be 1-2000 characters.");
          await env.DB.prepare(`UPDATE messages SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(content, mid).run();
          return j({ ok: true });
        }
        if (request.method === "DELETE") {
          await env.DB.prepare(`UPDATE messages SET deleted_at = CURRENT_TIMESTAMP, content = '' WHERE id = ?`).bind(mid).run();
          return j({ ok: true });
        }
        return notFound();
      }

      // ---- Chat Attachments Upload/Download ----
      // POST /api/attachments/upload — upload a file/media/contact for a conversation or message
      if (path === "/api/attachments/upload" && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);

        const contentType = request.headers.get("content-type") || "";
        if (!contentType.includes("multipart/form-data")) {
          return j({ ok: false, error: "Expected multipart/form-data" }, 400);
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;
        const conversationId = formData.get("conversation_id") as string | null;
        const messageId = formData.get("message_id") as string | null;
        // attachment_type from form is optional, we'll determine from file if not provided
        const attachmentTypeFromForm = formData.get("attachment_type") as string | null;

        if (!file) return j({ ok: false, error: "No file provided" }, 400);
        if (!conversationId && !messageId) return j({ ok: false, error: "conversation_id or message_id required" }, 400);

        // Validate file
        const maxSize = 50 * 1024 * 1024; // 50MB
        if (file.size > maxSize) return j({ ok: false, error: "File too large (max 50MB)" }, 400);

        // Determine attachment type from file if not provided
        let attachmentType: string = "file";
        const mimeType = file.type || "application/octet-stream";
        if (mimeType.startsWith("image/")) attachmentType = "image";
        else if (mimeType.startsWith("video/")) attachmentType = "video";
        else if (mimeType.startsWith("audio/")) attachmentType = "audio";
        else if (mimeType.startsWith("text/") || mimeType === "application/vnd.contact+xml" || mimeType === "text/vcard") attachmentType = "contact";
        else attachmentType = "file";

        // Generate R2 key
        // Generate R2 key
        const attachmentId = newId("att");
        const ext = file.name.split(".").pop() || "";
const r2Key = `attachments/${userId}/${Date.now()}-${attachmentId}.${ext}`;

        // Upload to R2 - use arrayBuffer to avoid stream type issues
        if (!env.CHAT_ATTACHMENTS) {
          return j({ ok: false, error: "File storage not configured. Enable R2 in Cloudflare Dashboard." }, 503);
        }
        try {
          const arrayBuffer = await file.arrayBuffer();
          await env.CHAT_ATTACHMENTS.put(r2Key, arrayBuffer, {
            httpMetadata: { contentType: mimeType },
            customMetadata: { userId, originalName: file.name },
          });
        } catch (e) {
          return j({ ok: false, error: "Failed to upload file" }, 500);
        }

        await env.DB.prepare(
          `INSERT INTO message_attachments (id, message_id, attachment_type, file_name, file_size, mime_type, r2_key, created_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`
        ).bind(attachmentId, "file", file.name, file.size, mimeType, r2Key, new Date().toISOString()).run();

        const downloadUrl = `${new URL(request.url).origin}/api/attachments/${attachmentId}/download`;

        return j({ ok: true, attachment: {
          id: attachmentId,
          attachment_type: "file",
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          download_url: downloadUrl,
        } }, 201);
      }

      // GET /api/attachments/:id/download — download an attachment
      if (path.match(/^\/api\/attachments\/([^/]+)\/download$/) && request.method === "GET") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);

        const attachmentId = decodeURIComponent(path.split("/")[3]);

        const attachment = await env.DB.prepare(
          `SELECT * FROM message_attachments WHERE id = ?`
        ).bind(attachmentId).first();

        if (!attachment) return j({ ok: false, error: "Attachment not found" }, 404);

        // Verify user has access (either sender or participant in conversation)
        const message = await env.DB.prepare(
          `SELECT m.*, cp.user_id FROM messages m
           JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id
           WHERE m.id = ? AND cp.user_id = ?`
        ).bind(attachment.message_id, userId).first();

        if (!message) return j({ ok: false, error: "Access denied" }, 403);

        if (!env.CHAT_ATTACHMENTS) {
          return j({ ok: false, error: "File storage not configured. Enable R2 in Cloudflare Dashboard." }, 503);
        }

        const attachmentRecord = attachment as Record<string, unknown>;
        const r2Key = attachmentRecord.r2_key as string;
        const mimeType = attachmentRecord.mime_type as string;
        const fileName = attachmentRecord.file_name as string;

        const object = await env.CHAT_ATTACHMENTS.get(r2Key);
        if (!object) return j({ ok: false, error: "File not found in storage" }, 404);

        return new Response(object.body as ReadableStream<Uint8Array>, {
          headers: {
            "Content-Type": mimeType,
            "Content-Disposition": `inline; filename="${fileName}"`,
            "Cache-Control": "public, max-age=31536000",
          },
        });
      }

      // ---- AI usage metrics (persisted; powers dashboards) ---------------------
      if (path === "/api/ai/log" && request.method === "POST") {
        const userId = await requireChatUser();
        if (!userId) return j({ ok: false, error: "Not signed in." }, 401);
        try {
          await env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, feature TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', latency_ms INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`
          ).run();
        } catch { /* exists */ }
        const body = await readJson<{ feature?: unknown; model?: unknown; latency_ms?: unknown; ok?: unknown }>(request);
        const feature = typeof body?.feature === "string" ? body.feature.slice(0, 40) : "unknown";
        const model = typeof body?.model === "string" ? body.model.slice(0, 80) : "gemini-2.5-flash";
        const latency = typeof body?.latency_ms === "number" ? Math.max(0, Math.floor(body.latency_ms)) : 0;
        const ok = body?.ok === false || body?.ok === 0 ? 0 : 1;
        await env.DB.prepare(`INSERT INTO ai_usage_events (id, user_id, feature, model, latency_ms, ok) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(newId("ai"), userId, feature, model, latency, ok).run();
        return j({ ok: true });
      }

      return notFound();
    } catch (err) {
      return j({ ok: false, error: err instanceof Error ? err.message : "Internal error." }, 500);
    }
  },
};

export default backend;
