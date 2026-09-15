import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useReminders() {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch('/customer/reminders');
      setItems(data);
    } catch (e) {
      console.error('reminders fetch failed', e);
      setItems([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (auctionId) => {
    let wasExists = false;
    setItems((prev) => {
      wasExists = prev.some((r) => r.auction_id === auctionId);
      if (wasExists) return prev.filter((r) => r.auction_id !== auctionId);
      return [...prev, { auction_id: auctionId }];
    });
    await new Promise((r) => setTimeout(r, 0));
    try {
      if (wasExists) await apiFetch(`/customer/reminders/${auctionId}`, { method: 'DELETE' });
      else await apiFetch('/customer/reminders', { method: 'POST', body: JSON.stringify({ auction_id: auctionId }) });
      await refresh();
    } catch (e) {
      console.error('reminders toggle failed', e);
      await refresh();
    }
  };

  return { items, toggle, refresh };
}
