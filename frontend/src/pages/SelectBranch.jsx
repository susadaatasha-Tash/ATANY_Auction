// frontend/src/pages/SelectBranch.jsx
// Customer branch selection page shown after first login when no preferred branch is set.
// Standalone page (no layout/sidebar) — fetches branches from public GET /branches,
// lets user pick one, then PUT /customer/preferred-branch before redirecting to /customer.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';
import { useToast } from '../shared/components/Toast';
import { supabase } from '../shared/lib/supabaseClient';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const styles = {
  page: {
    minHeight: '100vh',
    background: '#faf8f3',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: 'inherit',
  },
  header: {
    textAlign: 'center',
    marginBottom: 36,
  },
  eyebrow: {
    color: '#b8860b',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '.12em',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    color: '#14301f',
    margin: '0 0 8px',
  },
  subtitle: {
    fontSize: 13,
    color: '#7b8088',
    margin: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
    width: '100%',
    maxWidth: 960,
  },
  card: {
    background: '#fff',
    border: '1px solid #e5e2da',
    borderRadius: 12,
    padding: '24px 22px',
    cursor: 'pointer',
    transition: 'box-shadow .2s, border-color .2s',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardHover: {
    boxShadow: '0 6px 20px rgba(20,48,31,.10)',
    borderColor: '#b8860b',
  },
  cardName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#14301f',
    margin: 0,
  },
  cardDetail: {
    fontSize: 12,
    color: '#7b8088',
    lineHeight: 1.6,
    margin: 0,
  },
  cardSelectBtn: {
    marginTop: 6,
    width: '100%',
    padding: '10px 0',
    border: '1px solid #14301f',
    borderRadius: 8,
    background: '#14301f',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background .2s',
  },
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    color: '#7b8088',
    fontSize: 13,
  },
  spinner: {
    width: 32,
    height: 32,
    border: '3px solid #e5e2da',
    borderTopColor: '#b8860b',
    borderRadius: '50%',
    animation: 'spin .7s linear infinite',
  },
  errorWrap: {
    textAlign: 'center',
    color: '#7b8088',
    fontSize: 13,
  },
  retryBtn: {
    marginTop: 14,
    padding: '8px 20px',
    border: '1px solid #14301f',
    borderRadius: 8,
    background: 'transparent',
    color: '#14301f',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  logo: {
    fontSize: 20,
    fontWeight: 800,
    color: '#14301f',
    letterSpacing: '.04em',
    marginBottom: 24,
  },
};

export default function SelectBranch() {
  const { user, loading: authLoading, setPreferredBranchId } = useAuth();
  const showToast = useToast();
  const navigate = useNavigate();

  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selecting, setSelecting] = useState(null);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    let cancelled = false;

    async function loadBranches() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/branches`);
        if (!res.ok) throw new Error('Failed to load branches');
        const data = await res.json();
        const all = Array.isArray(data) ? data : data.branches ?? [];
        if (!cancelled) setBranches(all.filter(b => /davao/i.test(b.address || '')));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load branches');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBranches();
    return () => { cancelled = true; };
  }, [user, authLoading, navigate]);

  async function handleSelect(branch) {
    if (selecting) return;
    setSelecting(branch.id ?? branch._id);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${apiBase}/customer/preferred-branch`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ branch_id: branch.id ?? branch._id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || 'Failed to set preferred branch');
      }

      showToast(`Branch set to ${branch.name}`);
      setPreferredBranchId(branch.id ?? branch._id);
      navigate('/customer', { replace: true });
    } catch (err) {
      showToast(err.message || 'Something went wrong');
      setSelecting(null);
    }
  }

  if (loading || authLoading) {
    return (
      <div className="public-page" style={styles.page}>
        <div style={styles.logo}>ATANY</div>
        <div style={styles.loadingWrap}>
          <div style={styles.spinner} />
          <span>Loading branches...</span>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-page" style={styles.page}>
        <div style={styles.logo}>ATANY</div>
        <div style={styles.errorWrap}>
          <p>{error}</p>
          <button style={styles.retryBtn} onClick={() => window.location.reload()}>Try Again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="public-page" style={styles.page}>
      <div style={styles.logo}>ATANY</div>

      <div style={styles.header}>
        <div style={styles.eyebrow}>SELECT YOUR BRANCH</div>
        <h1 style={styles.title}>Choose a Pickup Location</h1>
        <p style={styles.subtitle}>
          Select your preferred branch for order pickups. You can change this later in your account settings.
        </p>
      </div>

      {branches.length === 0 ? (
        <div style={styles.errorWrap}>No branches available at this time.</div>
      ) : (
        <div style={styles.grid}>
          {branches.map((branch) => {
            const id = branch.id ?? branch._id;
            const isHovered = hovered === id;
            const isSelecting = selecting === id;
            const disabled = selecting !== null;

            return (
              <div
                key={id}
                style={{ ...styles.card, ...(isHovered && !disabled ? styles.cardHover : {}) }}
                onMouseEnter={() => !disabled && setHovered(id)}
                onMouseLeave={() => setHovered(null)}
              >
                <h3 style={styles.cardName}>{branch.name}</h3>
                {branch.address && (
                  <p style={styles.cardDetail}>{branch.address}</p>
                )}
                {branch.hours && (
                  <p style={styles.cardDetail}>{branch.hours}</p>
                )}
                <button
                  style={{
                    ...styles.cardSelectBtn,
                    opacity: disabled && !isSelecting ? 0.5 : 1,
                    background: isSelecting ? '#b8860b' : '#14301f',
                    cursor: disabled ? 'default' : 'pointer',
                  }}
                  disabled={disabled}
                  onClick={() => handleSelect(branch)}
                  onMouseEnter={(e) => {
                    if (!disabled) e.currentTarget.style.background = '#b8860b';
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled) e.currentTarget.style.background = '#14301f';
                  }}
                >
                  {isSelecting ? 'Setting...' : 'Select Branch'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
