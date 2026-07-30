import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Polling hook: calls the async fetcher every intervalMs.
 * - Pauses when tab hidden
 * - Returns { data, loading, error, refresh }
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
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    let cancelled = false;
    const run = async () => { if (!cancelled) await load(); };
    run();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs]);

  return { data, loading, error, refresh: load };
}
