import { useCallback, useEffect, useState, useRef } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useReminders() {
  const [items, setItems] = useState([]);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const data = await apiFetch('/customer/reminders');
      if (seq !== seqRef.current) return;
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (seq !== seqRef.current) return;
      console.error('reminders fetch failed', e);
      setItems([]);
    }
  }, []);

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
