// frontend/src/roles/shop-owner/hooks/useShopBranch.js
// Lightweight hook for layout — fetches only the shop's branch info
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../shared/lib/apiClient';

export function useShopBranch() {
  const [branchName, setBranchName] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/shop-owner/shop')
      .then((shop) => {
        if (!cancelled && shop?.branch_name) setBranchName(shop.branch_name);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return branchName;
}
