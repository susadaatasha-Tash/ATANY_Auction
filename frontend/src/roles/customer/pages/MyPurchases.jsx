// frontend/src/roles/customer/pages/MyPurchases.jsx
// Premium My Purchases redesign — dashboard header, metrics, tabs, cards, deadline, progress
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../../shared/lib/apiClient';
import { supabase } from '../../../shared/lib/supabaseClient';
import { useAuth } from '../../../shared/hooks/useAuth';
import { PurchaseHeader } from '../purchases/PurchaseHeader';
import { PurchaseStats } from '../purchases/PurchaseStats';
import { PurchaseTabs } from '../purchases/PurchaseTabs';
import { PurchaseToolbar } from '../purchases/PurchaseToolbar';
import { PurchaseCard } from '../purchases/PurchaseCard';
import { PurchaseSkeleton, PurchaseStatsSkeleton } from '../purchases/PurchaseSkeleton';
import {
  computePurchaseStats,
  countTabs,
  filterOrdersByTab,
  mapOrderRow,
  searchOrders,
  sortOrders,
} from '../lib/purchaseSelectors';
import '../purchases/purchases.css';

export default function MyPurchases({ orders: propOrders }) {
  const [orders, setOrders] = useState(propOrders ? propOrders.map(mapOrderRow) : []);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!propOrders?.length);
  const [liveLots, setLiveLots] = useState(0);
  const userIdRef = useRef(null);
  const silentRef = useRef(false);
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;

  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    if (authLoading) return;
    if (!userId && !propOrders?.length) {
      if (!silent) { setError(null); setOrders([]); setLoading(false); }
      return;
    }
    silentRef.current = silent;
    if (!silent) setLoading(true);
    try {
      const rows = await apiFetch('/customer/orders');
      setOrders((Array.isArray(rows) ? rows : []).map(mapOrderRow));
      setError(null);
    } catch (e) {
      if (e?.code === 'AUTH_REQUIRED' || e?.status === 401) {
        if (!silent) { setOrders([]); setError(null); setLoading(false); }
        silentRef.current = false;
        return;
      }
      if (!silent) {
        setError(e.message || 'Failed to load purchases');
        setOrders([]);
      }
    } finally {
      if (!silent) setLoading(false);
      silentRef.current = false;
    }
  }, [authLoading, userId, propOrders]);

  useEffect(() => {
    if (propOrders?.length) {
      setOrders(propOrders.map(mapOrderRow));
      setLoading(false);
      return;
    }
    loadOrders();
  }, [propOrders, loadOrders]);

  // Live lots badge — hide if 0 / endpoint unavailable (uses neutral Auctions endpoint)
  useEffect(() => {
    if (authLoading) return;
    if (!userId) { setLiveLots(0); return; }
    let cancelled = false;
    apiFetch('/customer/auctions?status=live')
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : (rows?.auctions || []);
        setLiveLots(list.length);
      })
      .catch((e) => { if (!cancelled) { if (e?.code !== 'AUTH_REQUIRED') setLiveLots(0); } });
    return () => { cancelled = true; };
  }, [authLoading, userId]);

  // Supabase realtime — refresh orders when buyer's orders/payments change
  useEffect(() => {
    let channel;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid || cancelled) return;
        userIdRef.current = uid;
        const channelName = `my-purchases-${uid}`;
        channel = supabase.channel(channelName);
        channel
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `buyer_id=eq.${uid}` },
            () => { loadOrders({ silent: true }); },
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'payments', filter: `customer_id=eq.${uid}` },
            () => { loadOrders({ silent: true }); },
          )
          .subscribe();
      } catch { /* auth not ready — no realtime */ }
    })();
    return () => {
      cancelled = true;
      try { if (channel) supabase.removeChannel(channel); } catch { /* ignore */ }
    };
  }, [loadOrders]);

  const stats = useMemo(() => computePurchaseStats(orders), [orders]);
  const counts = useMemo(() => countTabs(orders), [orders]);

  const visible = useMemo(() => {
    const byTab = filterOrdersByTab(orders, tab);
    const byQuery = searchOrders(byTab, query || globalQuery);
    return sortOrders(byQuery, sort);
  }, [orders, tab, query, globalQuery, sort]);

  const onGlobalQuerySubmit = useCallback((value, opts) => {
    if (opts?.live) {
      setGlobalQuery(value);
      setQuery(value);
      return;
    }
    setGlobalQuery(value);
    setQuery(value);
  }, []);

  return (
    <div className="mp-page">
      <PurchaseHeader
        globalQuery={globalQuery}
        onGlobalQuerySubmit={onGlobalQuerySubmit}
        liveLots={liveLots}
      />

      {loading ? (
        <>
          <PurchaseStatsSkeleton />
          <div className="mp-list">
            <PurchaseSkeleton />
            <PurchaseSkeleton />
          </div>
        </>
      ) : error ? (
        <div className="mp-empty mp-empty-error">
          <h2>Unable to load purchases</h2>
          <p>{error}</p>
          <button type="button" className="mp-btn mp-btn-gold" onClick={() => loadOrders()}>Try again</button>
        </div>
      ) : (
        <>
          <PurchaseStats stats={stats} />
          <div className="mp-controls">
            <PurchaseTabs counts={counts} active={tab} onChange={setTab} />
            <PurchaseToolbar query={query} onQueryChange={setQuery} sort={sort} onSortChange={setSort} />
          </div>

          {visible.length ? (
            <div className="mp-list">
              {visible.map((o) => <PurchaseCard key={o.id} order={o} />)}
            </div>
          ) : (
            <div className="mp-empty">
              <div className="mp-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
              </div>
              <h2>No purchases yet</h2>
              <p>Your jewelry purchases will appear here after you win an auction.</p>
              <Link to="/customer/auctions" className="mp-btn mp-btn-gold">Explore Auctions</Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
