// Dependency-free browser error reporting.
//
// Batches global `error` / `unhandledrejection` events and POSTs them as JSON
// `{ events: [...] }`. The endpoint defaults to the same-origin collector
// (`POST /api/client-errors`, stored in D1, read in the admin Errors tab), so
// reporting works on every deploy with zero configuration. Point
// NEXT_PUBLIC_TELEMETRY_URL at a Sentry HTTP ingest endpoint instead to
// forward there.

let installed = false;
let totalReported = 0;
const SESSION_CAP = 100;

export function initTelemetry(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  // Same-origin default: the app and the API share an origin, so a relative
  // path needs no CORS and no extra secret.
  const endpoint = (process.env.NEXT_PUBLIC_TELEMETRY_URL ?? "").trim() || "/api/client-errors";

  const queue: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    const body = JSON.stringify({ events: batch });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, body);
        return;
      }
    } catch {
      // fall through to fetch
    }
    fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
  };

  const enqueue = (payload: unknown) => {
    queue.push(payload);
    if (queue.length >= 10) {
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, 5000);
    }
  };

  const report = (kind: string, e: unknown) => {
    // A throwing error handler reporting its own failures would loop forever.
    if (totalReported >= SESSION_CAP) return;
    totalReported++;
    enqueue({
      kind,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      url: window.location.href,
      ts: new Date().toISOString(),
    });
  };

  window.addEventListener("error", (ev) => report("error", ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => report("unhandledrejection", ev.reason));
}
