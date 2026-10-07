"use client";

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
      // A new SW controlling a page pointing at old chunk hashes breaks the
      // app shell: reload once so the new document + new chunks match.
      const onChange = () => window.location.reload();
      navigator.serviceWorker.addEventListener("controllerchange", onChange);
      return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
    }
    return undefined;
  }, []);
  return null;
}
