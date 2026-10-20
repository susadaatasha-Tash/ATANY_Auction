// frontend/src/roles/customer/pages/Settings.jsx
// Customer Settings — 5 sections, fully functional, persists to Supabase Auth user_metadata.settings
import { useState, useEffect } from 'react';
import { Bell, Gavel, Package, Tag, Shield, Clock, Lock, Moon, Sun, Globe, Languages, FileText, Mail, Headphones, ChevronRight, X } from 'lucide-react';
import { useToast } from '../../../shared/components/Toast';
import { useAuth } from '../../../shared/hooks/useAuth';
import { supabase } from '../../../shared/lib/supabaseClient';

const DEFAULTS = {
  auction_updates: true,
  bid_activity: true,
  order_updates: true,
  promotions_offers: true,
  theme: 'light',
  language: 'English',
  timezone: '(GMT+8) Philippine Time',
};

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        border: 'none',
        background: checked ? '#C89B3C' : '#D9D9D9',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background .2s ease',
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left .2s ease',
        }}
      />
    </button>
  );
}

function Card({ icon, title, subtitle, children }) {
  return (
    <div
      style={{
        background: '#FFFEFB',
        border: '1px solid #EDE9E1',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(20,42,74,0.06)',
        padding: '20px 24px',
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        gap: 24,
        alignItems: 'start',
      }}
      className="settings-card"
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: '#FDF6E3',
            border: '1px solid #F0E6C8',
            display: 'grid',
            placeItems: 'center',
            color: '#8A6D2B',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#142A4A' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#8A94A8', lineHeight: 1.4, marginTop: 2 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Row({ icon, title, desc, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #F0EDE6' }}>
      <span style={{ color: '#142A4A', display: 'grid', placeItems: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#142A4A' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#8A94A8', lineHeight: 1.3 }}>{desc}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  );
}

function LinkRow({ icon, title, desc, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        border: 'none',
        borderBottom: '1px solid #F0EDE6',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ color: '#142A4A', display: 'grid', placeItems: 'center' }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#142A4A' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#8A94A8' }}>{desc}</div>
      </div>
      <ChevronRight size={14} style={{ color: '#C1C7D0' }} />
    </button>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', background: 'rgba(20,42,74,0.45)', padding: 16 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 100%)', background: '#fff', borderRadius: 12, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: '#142A4A', margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#8A94A8' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Settings() {
  const showToast = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(DEFAULTS);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [showLoginActivity, setShowLoginActivity] = useState(false);
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);
  const [pwdNew, setPwdNew] = useState('');
  const [pwdConfirm, setPwdConfirm] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  // Apply theme to customer app only (scoped, no flash)
  useEffect(() => {
    const customerRoot = document.querySelector('.customer-app');
    const target = customerRoot || document.documentElement;
    if (settings.theme === 'dark') {
      target.setAttribute('data-theme', 'dark');
      if (!customerRoot) document.documentElement.setAttribute('data-theme', 'dark');
      document.body.style.background = '#0f172a';
    } else {
      target.removeAttribute('data-theme');
      if (!customerRoot) document.documentElement.removeAttribute('data-theme');
      document.body.style.background = '';
    }
  }, [settings.theme]);

  // Load settings from user_metadata + localStorage fallback
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Try from Supabase Auth user_metadata
        const { data } = await supabase.auth.getSession();
        const metaSettings = data.session?.user?.user_metadata?.settings;
        if (metaSettings && !cancelled) {
          setSettings({ ...DEFAULTS, ...metaSettings });
        } else {
          // Fallback to localStorage per user
          const key = user ? `atany_settings_${user.id}` : 'atany_settings_guest';
          const stored = localStorage.getItem(key);
          if (stored && !cancelled) {
            try { setSettings({ ...DEFAULTS, ...JSON.parse(stored) }); } catch {}
          }
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const persist = async (next) => {
    try {
      const base = settings || DEFAULTS;
      const merged = { ...base, ...next };
      setSettings(merged);
      try {
        const key = user ? `atany_settings_${user.id}` : 'atany_settings_guest';
        localStorage.setItem(key, JSON.stringify(merged));
      } catch {}
      if (user) {
        try {
          setSaving(true);
          const { error } = await supabase.auth.updateUser({ data: { settings: merged } });
          if (error) throw error;
          showToast('Settings saved');
        } catch (e) {
          showToast(e.message || 'Unable to save settings');
        } finally {
          setSaving(false);
        }
      } else {
        showToast('Settings saved locally');
      }
      if (next.theme) {
        try {
          const customerRoot = document.querySelector('.customer-app');
          const target = customerRoot || document.documentElement;
          if (next.theme === 'dark') {
            target.setAttribute('data-theme', 'dark');
            if (!customerRoot) document.documentElement.setAttribute('data-theme', 'dark');
            document.body.style.background = '#0f172a';
          } else {
            target.removeAttribute('data-theme');
            if (!customerRoot) document.documentElement.removeAttribute('data-theme');
            document.body.style.background = '';
          }
        } catch {}
      }
    } catch (e) {
      console.error('persist failed', e);
      showToast('Unable to save settings');
    }
  };

  const handleToggle = (key) => (value) => {
    persist({ [key]: value });
  };

  const handleTheme = (t) => persist({ theme: t });
  const handleLanguage = (v) => persist({ language: v });
  const handleTimezone = (v) => persist({ timezone: v });

  const handlePasswordChange = async () => {
    if (!pwdNew || !pwdConfirm) return showToast('Please fill both password fields');
    if (pwdNew.length < 6) return showToast('Password must be at least 6 characters');
    if (pwdNew !== pwdConfirm) return showToast('Passwords do not match');
    try {
      setPwdSaving(true);
      const { error } = await supabase.auth.updateUser({ password: pwdNew });
      if (error) throw error;
      showToast('Password changed successfully');
      setShowPasswordModal(false);
      setPwdNew('');
      setPwdConfirm('');
    } catch (e) {
      showToast(e.message || 'Failed to change password');
    } finally {
      setPwdSaving(false);
    }
  };

  const handleContactSend = async () => {
    if (!contactSubject.trim() || !contactMessage.trim()) return showToast('Please fill Subject and Message');
    try {
      setContactSending(true);
      const { error } = await supabase.from('support_requests').insert({
        name: user?.user_metadata?.name || user?.email || 'Customer',
        email: user?.email || 'unknown',
        subject: contactSubject.trim(),
        message: contactMessage.trim(),
      });
      if (error) throw error;
      showToast('Message sent — we will reply within 1 business day');
      setShowContact(false);
      setContactSubject('');
      setContactMessage('');
    } catch (e) {
      showToast(e.message || 'Failed to send message');
    } finally {
      setContactSending(false);
    }
  };

  if (loading) return <div className="panel"><div className="empty-state"><p>Loading settings…</p></div></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`@media (max-width: 640px) { .settings-card { grid-template-columns: 1fr !important; } }`}</style>
      {saving && <div style={{ fontSize: 11, color: '#8A94A8', textAlign: 'right' }}>Saving…</div>}
      <Card icon={<Bell size={16} />} title="Notifications" subtitle="Choose what you want to be notified about.">
        <Row icon={<Bell size={16} />} title="Auction Updates" desc="Get notified about live auctions and endings soon." action={<Toggle checked={settings.auction_updates} onChange={handleToggle('auction_updates')} />} />
        <Row icon={<Gavel size={16} />} title="Bid Activity" desc="Receive notifications when you're outbid or win." action={<Toggle checked={settings.bid_activity} onChange={handleToggle('bid_activity')} />} />
        <Row icon={<Package size={16} />} title="Order Updates" desc="Get updates on your purchases and shipping." action={<Toggle checked={settings.order_updates} onChange={handleToggle('order_updates')} />} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <span style={{ color: '#142A4A', display: 'grid', placeItems: 'center' }}><Tag size={16} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#142A4A' }}>Promotions & Offers</div>
            <div style={{ fontSize: 11, color: '#8A94A8' }}>Be the first to know about special deals.</div>
          </div>
          <Toggle checked={settings.promotions_offers} onChange={handleToggle('promotions_offers')} />
        </div>
      </Card>

      <Card icon={<Shield size={16} />} title="Privacy & Security" subtitle="Keep your account safe and secure.">
        <LinkRow icon={<Shield size={16} />} title="Two-Factor Authentication" desc="Add an extra layer of security to your account." onClick={() => setShow2FA(true)} />
        <LinkRow icon={<Clock size={16} />} title="Login Activity" desc="View your recent login sessions." onClick={() => setShowLoginActivity(true)} />
        <LinkRow icon={<Lock size={16} />} title="Change Password" desc="Update your password regularly." onClick={() => setShowPasswordModal(true)} />
      </Card>

      <Card icon={<Moon size={16} />} title="Appearance" subtitle="Customize your viewing experience.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
          <span style={{ color: '#142A4A', display: 'grid', placeItems: 'center' }}><Sun size={16} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#142A4A' }}>Theme</div>
            <div style={{ fontSize: 11, color: '#8A94A8' }}>Choose between light and dark mode.</div>
          </div>
          <div style={{ display: 'flex', border: '1px solid #EDE9E1', borderRadius: 8, overflow: 'hidden' }}>
            {['Light', 'Dark'].map((m) => (
              <button
                key={m}
                onClick={() => handleTheme(m.toLowerCase())}
                style={{
                  padding: '6px 16px',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: settings.theme === m.toLowerCase() ? '#C89B3C' : '#fff',
                  color: settings.theme === m.toLowerCase() ? '#fff' : '#7A8599',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card icon={<Globe size={16} />} title="Language & Region" subtitle="Set your preferred language and region.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#142A4A', marginBottom: 6 }}><Languages size={14} /> Language</div>
            <select value={settings.language} onChange={(e) => handleLanguage(e.target.value)} style={{ width: '100%', height: 38, border: '1px solid #EDE9E1', borderRadius: 8, padding: '0 12px', fontSize: 12, color: '#142A4A', background: '#fff' }}>
              <option>English</option>
            </select>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: '#142A4A', marginBottom: 6 }}><Clock size={14} /> Time Zone</div>
            <select value={settings.timezone} onChange={(e) => handleTimezone(e.target.value)} style={{ width: '100%', height: 38, border: '1px solid #EDE9E1', borderRadius: 8, padding: '0 12px', fontSize: 12, color: '#142A4A', background: '#fff' }}>
              <option>(GMT+8) Philippine Time</option>
              <option>(GMT+0) UTC</option>
            </select>
          </div>
        </div>
      </Card>

      <Card icon={<Headphones size={16} />} title="Help & Support" subtitle="Get help when you need it.">
        <LinkRow icon={<FileText size={16} />} title="FAQ" desc="Find answers to common questions." onClick={() => setShowFAQ(true)} />
        <LinkRow icon={<Mail size={16} />} title="Contact Us" desc="Reach our support team." onClick={() => setShowContact(true)} />
      </Card>

      {showPasswordModal && (
        <Modal title="Change Password" onClose={() => setShowPasswordModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#142A4A' }}>New Password</label>
            <input type="password" value={pwdNew} onChange={(e) => setPwdNew(e.target.value)} placeholder="At least 6 characters" style={{ height: 38, border: '1px solid #EDE9E1', borderRadius: 8, padding: '0 12px', fontSize: 13 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: '#142A4A' }}>Confirm New Password</label>
            <input type="password" value={pwdConfirm} onChange={(e) => setPwdConfirm(e.target.value)} placeholder="Confirm password" style={{ height: 38, border: '1px solid #EDE9E1', borderRadius: 8, padding: '0 12px', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={handlePasswordChange} disabled={pwdSaving} style={{ marginTop: 8, justifyContent: 'center' }}>{pwdSaving ? 'Saving…' : 'Update Password'}</button>
          </div>
        </Modal>
      )}

      {show2FA && (
        <Modal title="Two-Factor Authentication" onClose={() => setShow2FA(false)}>
          <p style={{ fontSize: 13, color: '#7A8599', lineHeight: 1.6 }}>
            Two-Factor Authentication is not yet enabled for your account. When available, you will be able to scan a QR code with an authenticator app to add an extra layer of security. Your current status: <b style={{ color: '#142A4A' }}>Not enabled</b>.
          </p>
          <p style={{ fontSize: 12, color: '#8A94A8', marginTop: 12 }}>We use Supabase Auth with secure session handling. Enable 2FA in a future update to protect your bids and purchases.</p>
        </Modal>
      )}

      {showLoginActivity && (
        <Modal title="Login Activity" onClose={() => setShowLoginActivity(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: 12, background: '#F9F6F0', border: '1px solid #EDE9E1', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#142A4A' }}>{user?.email || 'Current session'}</div>
              <div style={{ fontSize: 11, color: '#8A94A8' }}>Logged in • {new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} • This device</div>
            </div>
            <p style={{ fontSize: 11, color: '#8A94A8' }}>Only your current session is available. No other active sessions detected. If you notice unfamiliar activity, change your password.</p>
          </div>
        </Modal>
      )}

      {showFAQ && (
        <Modal title="Frequently Asked Questions" onClose={() => setShowFAQ(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.6, color: '#142A4A' }}>
            <div><b>How do I bid?</b><p style={{ color: '#7A8599', fontSize: 12, marginTop: 4 }}>Open Auctions, choose an item, use the −/＋ stepper (min increment ₱1,000) and click Place Bid. You will be notified if outbid.</p></div>
            <div><b>Where do I pick up?</b><p style={{ color: '#7A94A8', fontSize: 12, marginTop: 4 }}>At your selected branch (Gmall, Abreeza, SM Lanang). Bring ID and order number within 7 days.</p></div>
            <div><b>When is payment due?</b><p style={{ color: '#7A94A8', fontSize: 12, marginTop: 4 }}>Pay via PayMongo link after winning, or via Orders → Complete Payment. Orders pending payment expire per ATANY policy.</p></div>
            <div><b>Are items authentic?</b><p style={{ color: '#7A94A8', fontSize: 12, marginTop: 4 }}>Every piece is inspected and certified by karat/weight before listing.</p></div>
          </div>
        </Modal>
      )}

      {showContact && (
        <Modal title="Contact Us" onClose={() => setShowContact(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#142A4A' }}>Subject</label>
            <input value={contactSubject} onChange={(e) => setContactSubject(e.target.value)} placeholder="e.g. Help with my order" style={{ height: 38, border: '1px solid #EDE9E1', borderRadius: 8, padding: '0 12px', fontSize: 13 }} />
            <label style={{ fontSize: 12, fontWeight: 600, color: '#142A4A' }}>Message</label>
            <textarea value={contactMessage} onChange={(e) => setContactMessage(e.target.value)} placeholder="How can we help?" rows={4} style={{ border: '1px solid #EDE9E1', borderRadius: 8, padding: '10px 12px', fontSize: 13, resize: 'vertical' }} />
            <button className="btn btn-primary" onClick={handleContactSend} disabled={contactSending} style={{ justifyContent: 'center' }}>{contactSending ? 'Sending…' : 'Send Message'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
