// frontend/src/roles/customer/hooks/useFavorites.js
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useFavorites() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch('/customer/favorites');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('favorites fetch failed', e);
      setError(e.message || 'Failed to load favorites');
      setItems([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggle = async (productId) => {
    let wasExists = false;
    setItems((prev) => {
      wasExists = prev.some((w) => w.product_id === productId);
      if (wasExists) return prev.filter((w) => w.product_id !== productId);
      return [...prev, { product_id: productId, name: '...', img: '' }];
    });
    await new Promise((r) => setTimeout(r, 0));
    try {
      if (wasExists) await apiFetch(`/customer/favorites/${productId}`, { method: 'DELETE' });
      else await apiFetch('/customer/favorites', { method: 'POST', body: JSON.stringify({ product_id: productId }) });
      await refresh();
    } catch (e) {
      console.error('favorites toggle failed', e);
      await refresh();
    }
  };

  return { items, setItems, toggle, refresh, error };
}
