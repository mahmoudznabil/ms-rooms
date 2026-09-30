/**
 * Pages Function — the MS-ROOMS API.
 *
 * Runs on Cloudflare's edge next to the static assets, so the frontend and the
 * API share an origin. That is the whole point of moving off the standalone
 * Worker: same-origin means no CORS preflight, no SameSite=None cookies and no
 * cross-site cookie rules to get wrong.
 *
 * The request handler itself is unchanged — it lives in workers/backend.ts and
 * is shared verbatim. All this file does is adapt the Pages Function calling
 * convention (onRequest(context)) to the plain `fetch(request, env)` shape.
 */

import backend from "../../workers/backend";

interface PagesEnv {
  DB?: unknown;
  CHAT_ATTACHMENTS?: unknown;
  RECAPTCHA_SITE_KEY?: string;
  RECAPTCHA_SECRET_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  CALLS_ACCOUNT_ID?: string;
  CALLS_APP_ID?: string;
  CALLS_API_TOKEN?: string;
  FIREBASE_PROJECT_ID?: string;
}

export const onRequest = async (context: {
  request: Request;
  env: PagesEnv;
}): Promise<Response> => {
  // Cast through to the backend's own Env: the runtime supplies real D1Database
  // and R2Bucket instances for these bindings, but the backend deliberately
  // types DB loosely to avoid pulling workers-types into the app bundle.
  return backend.fetch(context.request, context.env as never);
};
