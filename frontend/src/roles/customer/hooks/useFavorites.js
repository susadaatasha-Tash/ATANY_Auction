// frontend/src/roles/customer/hooks/useFavorites.js
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useAuth } from '../../../shared/hooks/useAuth';

export function useFavorites() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id || null;

  const refresh = useCallback(async () => {
    if (authLoading) return;
    if (!userId) { setItems([]); return; }
    try {
      setError(null);
      const data = await apiFetch('/customer/favorites');
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      if (e?.code === 'AUTH_REQUIRED' || e?.status === 401) { setItems([]); return; }
      console.error('favorites fetch failed', e);
      setError(e.message || 'Failed to load favorites');
      setItems([]);
    }
  }, [authLoading, userId]);

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
