"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared async data layer (Phase 4): loading/error/empty/retry/abort in one
 * place so pages stop rendering errors as empty states and stop refetch
 * storms. Key on `user?.id`, not the whole user object.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useAsync<T>(key: string | null, loader: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!key);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!key) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader(ctrl.signal)
      .then((d) => {
        if (cancelled || ctrl.signal.aborted) return;
        setData(d);
      })
      .catch((e) => {
        if (cancelled || ctrl.signal.aborted) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load.");
      })
      .finally(() => {
        if (!cancelled && !ctrl.signal.aborted) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { data, loading, error, reload };
}
