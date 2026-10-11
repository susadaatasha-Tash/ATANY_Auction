// frontend/src/roles/admin/hooks/useAdminData.js
// Mirrors admin.html:1326-1378 mock stores — now via apiClient polling.
// Keeps live badge counts (admin.html:580, 599) reactive.
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useAdminData() {
  const [products, setProducts] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [users, setUsers] = useState([]);
  const [txns, setTxns] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [analytics, setAnalytics] = useState(null);

  const refresh = useCallback(async () => {
    const [p, a, u, t, s, b] = await Promise.all([
      apiFetch('/admin/products').catch(() => []),
      apiFetch('/admin/auctions').catch(() => []),
      apiFetch('/admin/users').catch(() => []),
      apiFetch('/admin/transactions').catch(() => []),
      apiFetch('/admin/security-alerts').catch(() => []),
      apiFetch('/branches', { public: true }).catch(() => []), // public endpoint, single source of truth spec 4.5
    ]);
    setProducts(p); setAuctions(a); setUsers(u); setTxns(t); setAlerts(s); setBranches(b);
  }, []);

  const loadAnalytics = useCallback(async (range = 6) => {
    const data = await apiFetch(`/admin/analytics?range=${range}`).catch(() => null);
    setAnalytics(data);
  }, []);

  useEffect(() => { refresh(); loadAnalytics(); }, [refresh, loadAnalytics]);

  return { products, auctions, users, txns, alerts, branches, analytics, refresh, loadAnalytics };
}
