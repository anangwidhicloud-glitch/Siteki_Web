import { useCallback, useEffect, useRef, useState } from "react";

export function useRemoteData(loader, dependencies = [], { silentRefresh = false } = {}) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const hasLoaded = useRef(false);

  const reload = useCallback(async () => {
    if (!silentRefresh || !hasLoaded.current) setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (err) {
      setError(err?.message || "Tidak dapat mengambil data.");
      setData([]);
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [...dependencies, silentRefresh]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}
