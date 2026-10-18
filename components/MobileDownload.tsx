"use client";

import { useEffect, useState } from "react";
import { Apple, Check, Download, ShieldCheck, Smartphone } from "lucide-react";

/**
 * App download button for the landing page.
 *
 * WHY THIS CHECKS AT RUNTIME INSTEAD OF BUILD TIME
 *
 * The Android APK is not committed to the repository. `scripts/stage-apk.mjs`
 * drops it into `public/downloads/` at deploy time, which means its presence is
 * a property of the deployment, not of the source tree. A build-time check
 * (fs.existsSync during the static export) would couple the page to a file that
 * is deliberately not in git, and would break the moment someone deployed the
 * site before building the app.
 *
 * Checking with a HEAD request means the operational flow is just:
 *
 *   1. build the APK
 *   2. npm run stage:apk -- path/to/app-release.apk
 *   3. npm run build && deploy
 *
 * and the button appears. No code change. Same flow is how a rebuild is pushed
 * to existing users, which matters because they install by hand.
 *
 * WHY THERE IS NO iOS DOWNLOAD
 *
 * iOS does not allow installing an app from a website outside the App Store.
 * TestFlight is the only pre-release route and Apple reviews it, enforces the
 * same in-app-purchase rules the web app does not use, and needs an Apple
 * Developer account. Pretending otherwise here would be a dead button, so iOS
 * says plainly that it is not available yet.
 */

const APK_PATH = "/downloads/ms-rooms.apk";
const SHA_PATH = "/downloads/ms-rooms.apk.sha256";

type Availability = "checking" | "ready" | "unavailable";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function MobileDownload() {
  const [state, setState] = useState<Availability>("checking");
  const [size, setSize] = useState<string>("");
  const [sha, setSha] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // no-store so a newly uploaded build is picked up on the next deploy
        // rather than answered from the CDN with the previous APK.
        const head = await fetch(APK_PATH, { method: "HEAD", cache: "no-store" });
        if (cancelled) return;
        if (!head.ok) {
          setState("unavailable");
          return;
        }
        setSize(formatBytes(Number(head.headers.get("content-length") ?? 0)));
        setState("ready");

        // The checksum is best-effort: a staged APK without its sidecar is
        // still downloadable, it just cannot be verified by the user.
        const sum = await fetch(SHA_PATH, { cache: "no-store" });
        if (!cancelled && sum.ok) {
          const text = (await sum.text()).trim();
          setSha(/^[a-f0-9]{64}$/i.test(text) ? text : "");
        }
      } catch {
        if (!cancelled) setState("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mt-6 rounded-2xl border border-line bg-ink-raised/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <Smartphone size={16} className="shrink-0 text-coin" />
            Android app
            {state === "ready" ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                <Check size={11} /> Ready
              </span>
            ) : (
              <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-bold text-paper-dim">
                {state === "checking" ? "Checking…" : "Not released yet"}
              </span>
            )}
          </p>

          <p className="mt-2 text-xs leading-relaxed text-paper-dim">
            {state === "ready" ? (
              <>
                Download the APK directly from this page{size ? ` · ${size}` : ""}. This is the
                official source — MS-ROOMS is not on the Google Play Store, so this is the only place
                to get it.
              </>
            ) : state === "checking" ? (
              <>Looking for the latest build…</>
            ) : (
              <>
                Not published yet. Use the web app in the meantime — your account, coins and rooms
                are the same wherever you sign in.
              </>
            )}
          </p>
        </div>

        {state === "ready" ? (
          <a
            href={APK_PATH}
            download
            className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full bg-coin px-5 py-2.5 text-sm font-extrabold text-ink transition hover:brightness-110"
          >
            <Download size={16} />
            Download APK
          </a>
        ) : (
          <span
            aria-hidden
            className="inline-flex min-h-[44px] shrink-0 cursor-not-allowed items-center gap-2 rounded-full border border-line px-5 py-2.5 text-sm font-bold text-paper-faint"
          >
            <Download size={16} />
            Download APK
          </span>
        )}
      </div>

      {state === "ready" && (
        <>
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
            <ShieldCheck size={14} className="mt-px shrink-0" />
            <span>
              Android will ask you to allow installs from this browser. Only do that here, and only
              if the file matches the checksum below. Check it with
              {" "}
              <code className="rounded bg-black/30 px-1 py-0.5 font-mono">
                sha256sum app-release.apk
              </code>
              .
            </span>
          </p>

          {sha && (
            <details className="mt-3 text-[11px] text-paper-dim">
              <summary className="cursor-pointer select-none font-semibold text-paper-dim">
                Verify the download
              </summary>
              <p className="mt-2 break-all font-mono leading-relaxed text-paper-faint">{sha}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}

/**
 * iOS column. Kept as its own component only so the copy can state the
 * constraint honestly rather than showing a button that cannot work.
 */
export function IosAvailability() {
  return (
    <div className="mt-6 rounded-2xl border border-line bg-ink-raised/60 p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-white">
        <Apple size={16} className="shrink-0 text-paper-dim" />
        iPhone app
        <span className="rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-bold text-paper-dim">
          Not released yet
        </span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-paper-dim">
        iOS does not allow apps to be installed from a website, so there is no download to offer
        here. We are working on it and will announce it when there is a route that does not involve
        the App Store.
      </p>
    </div>
  );
}
