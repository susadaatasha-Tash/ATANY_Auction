import { useCallback, useEffect, useState, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useAuth } from '../../../shared/hooks/useAuth';

export function useReminders() {
  const [items, setItems] = useState([]);
  const seqRef = useRef(0);
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;

  const refresh = useCallback(async () => {
    if (authLoading) return;
    if (!userId) { setItems([]); return; }
    const seq = ++seqRef.current;
    try {
      const data = await apiFetch('/customer/reminders');
      if (seq !== seqRef.current) return;
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (seq !== seqRef.current) return;
      if (e?.code === 'AUTH_REQUIRED' || e?.status === 401) { setItems([]); return; }
      console.error('reminders fetch failed', e);
      setItems([]);
    }
  }, [authLoading, userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (auctionId) => {
    // Determine existence BEFORE setItems (pure updater — safe under StrictMode re-execution)
    const key = String(auctionId);
    const wasExists = items.some((r) => String(r.auction_id) === key);
    if (wasExists) {
      setItems((prev) => prev.filter((r) => String(r.auction_id) !== key));
    } else {
      setItems((prev) => {
        if (prev.some((r) => String(r.auction_id) === key)) return prev;
        return [...prev, { auction_id: auctionId }];
      });
    }
    try {
      if (wasExists) await apiFetch(`/customer/reminders/${auctionId}`, { method: 'DELETE' });
      else await apiFetch('/customer/reminders', { method: 'POST', body: JSON.stringify({ auction_id: auctionId }) });
      // Success: keep optimistic state, bump seq to ignore stale mount refresh
      seqRef.current++;
      // Notify other useReminders instances (e.g., AuctionStartPopup) that reminders changed
      try { window.dispatchEvent(new CustomEvent('atany-reminders-updated', { detail: { auctionId, wasExists } })); } catch {}
      try { localStorage.setItem('atany-reminders-updated', String(Date.now())); } catch {}
    } catch (e) {
      console.error('reminders toggle failed', e);
      // Revert optimistic on failure by refreshing from DB
      await refresh();
      throw e;
    }
  };

  return { items, toggle, refresh };
}
