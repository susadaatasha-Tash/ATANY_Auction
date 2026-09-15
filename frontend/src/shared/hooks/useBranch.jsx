// frontend/src/shared/hooks/useBranch.jsx
// Customer branch context — loads preferred branch from DB, provides switcher.
// Distinguishes: preferred_branch (saved default) vs current browsing branch.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/apiClient';

const BranchContext = createContext(null);

export function BranchProvider({ children }) {
  const [branchId, setBranchId] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  // Load branches list + user's preferred branch on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [branchList, pref] = await Promise.all([
          apiFetch('/branches').catch(() => []),
          apiFetch('/customer/preferred-branch').catch(() => null),
        ]);
        if (cancelled) return;
        const openBranches = (Array.isArray(branchList) ? branchList : []).filter(b => b.status === 'Open');
        setBranches(openBranches);
        if (pref?.preferred_branch_id) {
          setBranchId(pref.preferred_branch_id);
          setBranchName(pref.branch_name || '');
        }
        // No fallback — if no preferred branch, branchId stays null
        // so CustomerLayout can redirect to /select-branch
      } catch {
        // Silent — branch filtering is best-effort
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Switch branch — updates local state + persists to backend
  const switchBranch = useCallback(async (newBranchId) => {
    const target = branches.find(b => b.id === newBranchId);
    if (!target) return;
    setBranchId(newBranchId);
    setBranchName(target.name);
    // Persist to backend (fire-and-forget — local state is already updated)
    apiFetch('/customer/preferred-branch', {
      method: 'PUT',
      body: JSON.stringify({ branch_id: newBranchId }),
    }).catch(() => {});
  }, [branches]);

  return (
    <BranchContext.Provider value={{ branchId, branchName, branches, loading, switchBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export const useBranch = () => {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used within BranchProvider');
  return ctx;
};
