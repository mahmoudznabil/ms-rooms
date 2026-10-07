// Dependency-free browser error reporting.
//
// When NEXT_PUBLIC_TELEMETRY_URL is set (build-time, static export), global
// `error` and `unhandledrejection` events are batched and POSTed there as JSON
// `{ events: [...] }`. Point it at:
//   - a Sentry HTTP ingest endpoint, or
//   - a tiny collector (Cloudflare Worker / any logging backend), or
//   - your own endpoint that forwards to your observability stack.
//
// When the URL is unset this is a no-op, so it costs nothing in production
// until an endpoint is configured. See docs/OPS.md §Observability.

let installed = false;

export function initTelemetry(): void {
  if (typeof window === "undefined" || installed) return;
  installed = true;

  const endpoint = (process.env.NEXT_PUBLIC_TELEMETRY_URL ?? "").trim();
  if (!endpoint) return;

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
