import { useCallback, useEffect, useRef, useState } from "react";

export function useRemoteData(loader, dependencies = [], { silentRefresh = false, retries = 3, retryDelay = 2500 } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoaded = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);

  const reload = useCallback(async (isRetry = false) => {
    if (!isRetry) {
      retryCountRef.current = 0;
      window.clearTimeout(retryTimerRef.current);
    }
    if (!silentRefresh || !hasLoaded.current) setLoading(true);
    if (!isRetry) setError("");
    try {
      const result = await loader();
      setData(result);
      setError("");
      hasLoaded.current = true;
      retryCountRef.current = 0;
    } catch (err) {
      const errorMsg = err?.message || "Tidak dapat mengambil data.";
      if (!hasLoaded.current) {
        setError(errorMsg);
      }
      if (retryCountRef.current < retries) {
        retryCountRef.current += 1;
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          reload(true);
        }, retryDelay * retryCountRef.current);
      }
    } finally {
      setLoading(false);
    }
  }, [...dependencies, silentRefresh, retries, retryDelay]);

  useEffect(() => {
    reload();
    return () => {
      window.clearTimeout(retryTimerRef.current);
    };
  }, [reload]);

  return { data, loading, error, reload };
}
