// frontend/src/roles/customer/hooks/useWishlist.js
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useWishlist() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch('/customer/watchlist');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('watchlist fetch failed', e);
      setError(e.message || 'Failed to load watchlist');
      setItems([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (productId) => {
    // Optimistic: determine exists from current state synchronously, update UI immediately
    let wasExists = false;
    setItems((prev) => {
      wasExists = prev.some((w) => w.product_id === productId);
      if (wasExists) return prev.filter((w) => w.product_id !== productId);
      return [...prev, { product_id: productId, name: '...', img: '' }];
    });
    // Give React a tick to commit optimistic update before API call
    await new Promise((r) => setTimeout(r, 0));
    try {
      if (wasExists) await apiFetch(`/customer/watchlist/${productId}`, { method: 'DELETE' });
      else await apiFetch('/customer/watchlist', { method: 'POST', body: JSON.stringify({ product_id: productId }) });
      await refresh();
    } catch (e) {
      console.error('watchlist toggle failed', e);
      await refresh();
    }
  };

  return { items, setItems, toggle, refresh, error };
}
