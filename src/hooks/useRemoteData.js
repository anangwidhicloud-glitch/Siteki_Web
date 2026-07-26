import { useCallback, useEffect, useState } from "react";

export function useRemoteData(loader, dependencies = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await loader());
    } catch (err) {
      setError(err?.message || "Tidak dapat mengambil data.");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, dependencies);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

