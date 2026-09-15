// frontend/src/roles/shop-owner/hooks/useShopData.js
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useShopData() {
  const [listings, setListings] = useState([]);
  const [auctions, setAuctions] = useState([]);
  const [sales, setSales] = useState([]);
  const [shop, setShop] = useState(null);
  const [branches, setBranches] = useState([]);

  const refresh = useCallback(async () => {
    const [l, a, s, sh, b] = await Promise.all([
      apiFetch('/shop-owner/listings').catch(() => []),
      apiFetch('/shop-owner/auctions').catch(() => []),
      apiFetch('/shop-owner/sales').catch(() => []),
      apiFetch('/shop-owner/shop').catch(() => null),
      apiFetch('/branches').catch(() => []),
    ]);
    setListings(l); setAuctions(a); setSales(s); setShop(sh); setBranches(b);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { listings, auctions, sales, shop, branches, refresh };
}
