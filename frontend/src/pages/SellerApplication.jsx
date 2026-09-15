// frontend/src/pages/SellerApplication.jsx
// Public page for users to apply to become a seller.
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../shared/lib/supabaseClient';
import { useAuth } from '../shared/hooks/useAuth';
import { useToast } from '../shared/components/Toast';
import { PublicHeader } from '../shared/components/PublicHeader';
import { AssistantWidget } from '../shared/components/AssistantWidget';

const inputStyle = {
  width: '100%', height: 46, padding: '0 14px', border: '1px solid #e5e2da',
  borderRadius: 12, outline: 'none', background: '#fff', color: 'var(--text)', fontSize: 13,
};
const labelStyle = {
  display: 'block', color: '#000', fontSize: 13, fontWeight: 700, marginBottom: 6,
};
const textareaStyle = {
  width: '100%', padding: '12px 14px', border: '1px solid #e5e2da',
  borderRadius: 12, outline: 'none', background: '#fff', color: 'var(--text)',
  fontSize: 13, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit', minHeight: 80,
};

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function SellerApplication() {
  const { user } = useAuth();
  const showToast = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [branches, setBranches] = useState([]);
  const [submitted, setSubmitted] = useState(false);
  const [existingApp, setExistingApp] = useState(null);

  const [shopName, setShopName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [email, setEmail] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [branchId, setBranchId] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [applicationReason, setApplicationReason] = useState('');

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers = token ? { Authorization: `Bearer ${token}` } : {};

        const [branchRes, appRes] = await Promise.all([
          fetch(`${apiBase}/branches`, { headers }),
          token ? fetch(`${apiBase}/seller-applications/me`, { headers }) : Promise.resolve({ ok: false }),
        ]);

        if (branchRes.ok) {
          const branchData = await branchRes.json();
          setBranches(Array.isArray(branchData) ? branchData : branchData.data || []);
        }

        if (appRes.ok) {
          const appData = await appRes.json();
          setExistingApp(appData);
        }
      } catch (err) {
        console.error('Failed to load seller application data:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!shopName.trim() || !email.trim() || !shopAddress.trim() || !branchId || !businessDescription.trim() || !applicationReason.trim()) {
      showToast('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        showToast('Please sign in to submit an application');
        navigate('/login');
        return;
      }
      const res = await fetch(`${apiBase}/seller-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          shop_name: shopName.trim(),
          contact_number: contactNumber.trim() || undefined,
          email: email.trim().toLowerCase(),
          shop_address: shopAddress.trim(),
          branch_id: branchId,
          business_description: businessDescription.trim(),
          application_reason: applicationReason.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Submission failed');
      }
      setSubmitted(true);
      showToast('Application submitted successfully');
    } catch (err) {
      showToast(err.message || 'Failed to submit application');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
        <PublicHeader />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Loading…</p>
        </main>
      </div>
    );
  }

  const statusConfig = {
    pending: { color: '#D97706', bg: '#FEF3C7', label: 'Pending Review', icon: '◷' },
    approved: { color: '#059669', bg: '#D1FAE5', label: 'Approved', icon: '✓' },
    rejected: { color: '#DC2626', bg: '#FEE2E2', label: 'Rejected', icon: '✕' },
  };

  if (existingApp && !submitted) {
    const status = statusConfig[existingApp.status] || statusConfig.pending;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
        <PublicHeader />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ width: 'min(480px,100%)', background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 32px', boxShadow: 'var(--shadow)', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>{status.icon}</div>
            <h2 style={{ fontSize: 22, color: 'var(--navy)', fontWeight: 800, marginBottom: 8 }}>Application Status</h2>
            <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700, color: status.color, background: status.bg, marginBottom: 16 }}>
              {status.label}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
              Shop: <strong style={{ color: 'var(--navy)' }}>{existingApp.shop_name}</strong>
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
              Submitted on {new Date(existingApp.created_at).toLocaleDateString()}
            </p>
            {existingApp.status === 'rejected' && existingApp.rejection_reason && (
              <div style={{ textAlign: 'left', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#991B1B', marginBottom: 4 }}>Rejection Reason</p>
                <p style={{ fontSize: 12, color: '#7F1D1D', lineHeight: 1.6 }}>{existingApp.rejection_reason}</p>
              </div>
            )}
            {existingApp.status === 'pending' && (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>We typically review applications within 2–3 business days.</p>
            )}
            {existingApp.status === 'approved' && (
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Your seller account is active. You can now list items for auction.</p>
            )}
            <Link to="/" className="btn btn-primary" style={{ display: 'inline-block', marginTop: 12 }}>Back to Home</Link>
          </div>
        </main>
        <AssistantWidget mode="customer" />
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
        <PublicHeader />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ width: 'min(480px,100%)', background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 32px', boxShadow: 'var(--shadow)', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <h2 style={{ fontSize: 22, color: 'var(--navy)', fontWeight: 800, marginBottom: 8 }}>Your application has been submitted</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 20 }}>
              Thank you for your interest in becoming a seller on ATANY. Our team will review your application and get back to you within 2–3 business days.
            </p>
            <Link to="/" className="btn btn-primary" style={{ display: 'inline-block' }}>Back to Home</Link>
          </div>
        </main>
        <AssistantWidget mode="customer" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--cream)' }}>
      <PublicHeader />
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ width: 'min(560px,100%)', background: 'var(--ivory)', border: '1px solid var(--line)', borderRadius: 14, padding: '36px 32px', boxShadow: 'var(--shadow)' }}>
          <div style={{ color: 'var(--gold)', fontSize: 11, fontWeight: 700, letterSpacing: '.12em', marginBottom: 10 }}>SELLER APPLICATION</div>
          <h1 style={{ fontSize: 28, color: 'var(--navy)', fontWeight: 800, marginBottom: 6 }}>Apply to Become a Seller</h1>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 28 }}>Fill out the form below to request a seller account on ATANY.</p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Shop Name *</label>
              <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Your shop or business name" required style={inputStyle} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Contact Number</label>
                <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} placeholder="09XX XXX XXXX" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Email Address *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@shop.com" required style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Shop Address *</label>
              <input value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} placeholder="Full address of your shop" required style={inputStyle} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Nearest ATANY Branch *</label>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Select a branch</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.location ? ` — ${b.location}` : ''}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Business Description *</label>
              <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} placeholder="Describe your business and the types of jewelry you sell" required style={textareaStyle} rows={3} />
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Why do you want to sell on ATANY? *</label>
              <textarea value={applicationReason} onChange={(e) => setApplicationReason(e.target.value)} placeholder="Tell us why you'd like to join our platform" required style={textareaStyle} rows={3} />
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', minHeight: 46 }}>
              {submitting ? 'Submitting…' : 'Submit Application'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: 'var(--muted)' }}>
            Already have an account? <Link to="/login" style={{ color: 'var(--navy)', fontWeight: 700 }}>Sign in</Link>
          </p>
        </div>
      </main>
      <AssistantWidget mode="customer" />
    </div>
  );
}
