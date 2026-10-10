import { useCallback, useEffect, useRef, useState } from "react";

export function useRemoteData(
  loader,
  dependencies = [],
  { silentRefresh = true, retries = Infinity, retryDelay = 2000, maxRetryDelay = 8000 } = {}
) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoaded = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  const reload = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      retryCountRef.current = 0;
      window.clearTimeout(retryTimerRef.current);
    }

    // Only show full loading state on initial load when not in silent mode
    if (!silentRefresh || !hasLoaded.current) {
      if (isMountedRef.current) setLoading(true);
    }
    if (isMountedRef.current) setError("");

    try {
      const result = await loader();
      if (!isMountedRef.current) return;
      setData(result);
      setError("");
      hasLoaded.current = true;
      retryCountRef.current = 0;
    } catch (err) {
      if (!isMountedRef.current) return;
      const errorMsg = err?.message || "Tidak dapat mengambil data.";
      const maxRetries = retries === undefined ? Infinity : retries;

      // Only expose blocking error if retries are finite and exhausted, and no previous data exists
      if (!hasLoaded.current && isFinite(maxRetries) && retryCountRef.current >= maxRetries) {
        setError(errorMsg);
      }

      // Schedule continuous auto-recovery for wallboard/kiosk
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current += 1;
        const delay = Math.min(retryDelay * Math.min(retryCountRef.current, 3), maxRetryDelay);
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          if (isMountedRef.current) reload(true);
        }, delay);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [...dependencies, silentRefresh, retries, retryDelay, maxRetryDelay]);

  useEffect(() => {
    isMountedRef.current = true;
    reload();
    return () => {
      isMountedRef.current = false;
      window.clearTimeout(retryTimerRef.current);
    };
  }, [reload]);

  return { data, loading, error, reload };
}
