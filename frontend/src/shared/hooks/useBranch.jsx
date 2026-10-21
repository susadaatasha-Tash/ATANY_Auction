// frontend/src/shared/hooks/useBranch.jsx
// Customer branch context — loads preferred branch from DB, provides switcher.
// Distinguishes: preferred_branch (saved default) vs current browsing branch.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useToast } from '../components/Toast';
import { useAuth } from './useAuth';

const BranchContext = createContext(null);

export function BranchProvider({ children }) {
  const [branchId, setBranchId] = useState(null);
  const [branchName, setBranchName] = useState('');
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const showToast = useToast();
  const { setPreferredBranchId, user, loading: authLoading } = useAuth();
  const userId = user?.id || null;

  // Load branches list (public) immediately; preferred branch only when authenticated
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const branchList = await apiFetch('/branches', { public: true }).catch(() => []);
        if (cancelled) return;
        const openBranches = (Array.isArray(branchList) ? branchList : []).filter(b => b.status === 'Open');
        setBranches(openBranches);
      } catch {
        // Silent — branch list is best-effort public
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch preferred branch only after auth hydration and when authenticated
  const loadPreferredBranch = useCallback(async () => {
    const pref = await apiFetch('/customer/preferred-branch').catch(() => null);
    if (pref?.preferred_branch_id) {
      setBranchId(pref.preferred_branch_id);
      setBranchName(pref.branch_name || '');
      setPreferredBranchId(pref.preferred_branch_id);
    }
    return pref;
  }, [setPreferredBranchId]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        await loadPreferredBranch();
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [authLoading, userId, loadPreferredBranch]);

  // Re-read the preferred branch from the server (after a Profile save) so the
  // customer header reflects the new branch without a page reload.
  const refreshBranch = useCallback(async () => {
    try { return await loadPreferredBranch(); } catch { return null; }
  }, [loadPreferredBranch]);

  // Switch branch — updates local state only after backend succeeds
  const switchBranch = useCallback(async (newBranchId) => {
    const target = branches.find(b => b.id === newBranchId);
    if (!target) return;
    try {
      await apiFetch('/customer/preferred-branch', {
        method: 'PUT',
        body: JSON.stringify({ branch_id: newBranchId }),
      });
      setBranchId(newBranchId);
      setBranchName(target.name);
      setPreferredBranchId(newBranchId);
      showToast('Branch updated');
    } catch (e) {
      console.error('Failed to save preferred branch', e);
      showToast('Failed to update branch — please try again');
    }
  }, [branches, showToast, setPreferredBranchId]);

  return (
    <BranchContext.Provider value={{ branchId, branchName, branches, loading, switchBranch, refreshBranch }}>
      {children}
    </BranchContext.Provider>
  );
}

export const useBranch = () => {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error('useBranch must be used within BranchProvider');
  return ctx;
};
