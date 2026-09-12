import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Polling hook: calls the async fetcher every intervalMs.
 * - Retries faster (2s) after an error, to close the "data gone" window fast.
 * - Keeps the last successful `data` on error: a later fetch failure never
 *   wipes the UI. `loading` stays true only until the first success, so a
 *   component can render a loading state instead of an empty list.
 * - Pauses when tab hidden.
 *
 * Returns { data, loading, error, refresh }
 */
export default function usePolling(fetcher, deps = [], intervalMs = 5000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      const res = await fetcherRef.current();
      setData(res);
      setError(null);
      setLoading(false);
    } catch (e) {
      // Keep previous data (if any) — a transient failure must not blank the UI.
      setError(e);
      // If we have data already, stay in normal mode (show old data + error).
      // Only keep loading=true if we never loaded anything, so the caller can
      // render "Caricamento…" instead of an empty list.
      if (dataRef.current === null) {
        setLoading(true);
      }
      // else: leave loading=false, show last good data
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const errorRef = { current: null };

    const tick = async () => {
      if (cancelled) return;
      await load();
      if (cancelled) return;
      if (errorRef.current) {
        errorRef.current = null;
        timer = setTimeout(tick, 2000);
      } else {
        timer = setTimeout(tick, intervalMs);
      }
    };

    const trackError = () => { errorRef.current = true; };
    load().finally(trackError).catch(() => {});

    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs]);

  return { data, loading, error, refresh: load };
}