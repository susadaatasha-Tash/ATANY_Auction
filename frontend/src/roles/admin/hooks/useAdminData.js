// frontend/src/roles/admin/hooks/useAdminData.js
// Admin data store via apiClient (polling keeps live badge counts reactive).
//
// Loading contract (added for dashboard skeletons):
// - `loading`  → true only for the FIRST load, so consumers can show skeletons.
// - `refreshing` → true for background polls; consumers keep existing content
//   instead of flashing skeletons on every 15s refresh.
// - Each resource resolves independently via `settled`, so a slow request does
//   not blank the sections that are already ready.
import { useEffect, useState, useCallback, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useAdminData() {
  const [products, setProducts] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [users, setUsers] = useState([]);
  const [txns, setTxns] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  // Which resources have completed at least one request.
  const [settled, setSettled] = useState({});
  const firstLoadRef = useRef(true);

  const markSettled = useCallback((keys) => {
    setSettled((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    // Distinguish the initial load from background polling.
    if (firstLoadRef.current) setLoading(true);
    else setRefreshing(true);
    try {
      const [p, a, u, t, s, b] = await Promise.all([
        apiFetch('/admin/products').catch(() => []),
        apiFetch('/admin/auctions').catch(() => []),
        apiFetch('/admin/users').catch(() => []),
        apiFetch('/admin/transactions').catch(() => []),
        apiFetch('/admin/security-alerts').catch(() => []),
        apiFetch('/branches', { public: true }).catch(() => []), // public endpoint, single source of truth spec 4.5
      ]);
      setProducts(p); setAuctions(a); setUsers(u); setTxns(t); setAlerts(s); setBranches(b);
      setError(null);
      markSettled(['users', 'txns', 'branches', 'products', 'auctions', 'alerts']);
    } catch (e) {
      setError(e?.message || 'Unable to load dashboard data.');
    } finally {
      firstLoadRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [markSettled]);

  const loadAnalytics = useCallback(async (range = 6) => {
    const data = await apiFetch(`/admin/analytics?range=${range}`).catch(() => null);
    setAnalytics(data);
    markSettled(['analytics']);
  }, [markSettled]);

  // Single mount-time fetch. Consumers poll explicitly via refresh().
  useEffect(() => { refresh(); }, [refresh]);

  return {
    products, auctions, users, txns, alerts, branches, analytics,
    refresh, loadAnalytics,
    loading, refreshing, error, settled,
  };
}

export default useAdminData;