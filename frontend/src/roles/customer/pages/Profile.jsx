// frontend/src/roles/customer/pages/Profile.jsx
// Customer Profile — real profile editing, password change and Help & Support.
//
// Data sources (all real, no fixtures):
//   GET /customer/account        → own profile (name, email, phone, preferred branch)
//   GET /branches                → real branch list for the Preferred Branch picker
//   PUT /customer/account        → save name + phone (whitelisted server-side)
//   PUT /customer/preferred-branch → save preferred branch (customer-owned endpoint)
//   POST /customer/support       → authenticated support request (server derives identity)
//   Supabase Auth                → password change (provider owns credentials)
//
// Email is read-only: ATANY has no verified email-change flow, so it is never
// silently editable.
import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Mail, Phone, MapPin, User, ChevronRight, Send, HelpCircle, FileText, X } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { useAuth } from '../../../shared/hooks/useAuth';
import { useBranch } from '../../../shared/hooks/useBranch';
import { supabase } from '../../../shared/lib/supabaseClient';
import { validatePassword, validatePasswordMatch } from '../../../shared/validation/signupValidation';
import { PasswordField } from '../components/PasswordField';
import { SUPPORT_EMAIL, SUPPORT_CATEGORIES } from '../../../shared/config/support';



const FAQ_ITEMS = [
  {
    q: 'How do I bid on an auction?',
    a: 'Open Auctions, pick a lot that is live, and place a bid higher than the current bid by at least the lot\'s minimum bid increment. You will be notified if someone bids against you.',
  },
  {
    q: 'When do I have to pay after winning?',
    a: 'You have 7 days from the win to complete payment. If payment is not completed in time, the lot can pass to the next eligible bidder.',
  },
  {
    q: 'How do I collect my lot?',
    a: 'Pickup only — there is no delivery. Bring a valid government-issued ID to your pickup branch; your ID name must match your ATANY account. Please claim within 7 business days.',
  },
  {
    q: 'How do I pay?',
    a: 'Pay through the payment page on your order (PayMongo checkout — GCash, Maya or card), or ask at the branch counter when collecting your lot.',
  },
  {
    q: 'Can I change my account email?',
    a: 'Your account email is the address you signed up with and is shown read-only here, so it stays linked to your bids and purchases. Contact support if it has changed.',
  },
  {
    q: 'My account was suspended — what now?',
    a: 'A suspended account cannot bid or check out. Please contact our support team so we can review and restore your access.',
  },
];

export function Profile() {
  const showToast = useToast();
  const { user, profileName, refreshProfile } = useAuth();
  const [supportParams] = useSearchParams();
  const { branches, refreshBranch } = useBranch();

  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', branchId: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [pwdErrors, setPwdErrors] = useState({});
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdResetToken, setPwdResetToken] = useState(0);

  const [faqOpen, setFaqOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactCategory, setContactCategory] = useState('General Inquiry');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactSending, setContactSending] = useState(false);
  const [contactError, setContactError] = useState(null);
  const [contactReference, setContactReference] = useState('');
  const [contactMailSent, setContactMailSent] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const acct = await apiFetch('/customer/account');
      setAccount(acct);
      setForm({
        name: acct?.name || '',
        phone: acct?.phone || '',
        branchId: acct?.preferred_branch_id || '',
      });
    } catch (e) {
      setLoadError(e?.message || 'Unable to load your profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Real branches for the picker. Only branches that are currently open can be
  // chosen (matches the branch rules used across the customer app).
  const branchOptions = (branches || []).filter((b) => b.status === 'Open');

  // A suspended account cannot edit its profile (the backend rejects it with
  // 403 ACCOUNT_SUSPENDED) — the UI mirrors that and points at the existing
  // account-suspension support flow instead of a dead-end form.
  const isSuspended = String(account?.status || '').toLowerCase() === 'suspended';

  const handleSave = async () => {
    const errors = {};
    const name = form.name.trim();
    if (!name) errors.name = 'Full name is required.';
    else if (name.length > 120) errors.name = 'Full name must be at most 120 characters.';
    const phone = form.phone.trim();
    if (phone) {
      // Accept the common Philippine formats; the server normalises + validates.
      const digits = phone.replace(/[^\d+]/g, '');
      if (!/^(\+?63|0)?9\d{9}$/.test(digits)) {
        errors.phone = 'Enter a valid Philippine mobile number.';
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    // Only changed values are sent.
    const payload = {};
    if (name !== (account?.name || '')) payload.name = name;
    const currentPhone = account?.phone || '';
    if (phone !== currentPhone) payload.phone = phone;

    const branchChanged = form.branchId !== (account?.preferred_branch_id || '');
    if (!Object.keys(payload).length && !branchChanged) {
      showToast('No changes to save');
      return;
    }

    setSaving(true);
    try {
      if (Object.keys(payload).length) {
        const updated = await apiFetch('/customer/account', {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setAccount((prev) => ({ ...(prev || {}), ...(updated || {}) }));
        setForm((f) => ({
          ...f,
          name: updated?.name ?? f.name,
          phone: updated?.phone ?? f.phone,
        }));
      }
      if (branchChanged) {
        await apiFetch('/customer/preferred-branch', {
          method: 'PUT',
          body: JSON.stringify({ branch_id: form.branchId }),
        });
      }
      // Refresh the global auth + branch state so the header and the account
      // dropdown show the new name/branch immediately — no page reload.
      await refreshProfile?.();
      if (branchChanged) await refreshBranch?.();
      showToast('Profile updated successfully.');
    } catch (e) {
      showToast(e?.message || 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    const errors = {};
    const currentErr = validatePasswordMatch(pwd.current, pwd.current); // required check
    if (!pwd.current) errors.current = 'Current password is required.';
    else if (currentErr) errors.current = currentErr;
    if (!pwd.next) errors.next = 'New password is required.';
    else {
      const policy = validatePassword(pwd.next);
      if (policy) errors.next = policy;
      else if (pwd.next === pwd.current) errors.next = 'New password must be different from the current password.';
    }
    if (!pwd.confirm) errors.confirm = 'Please confirm your password.';
    else if (pwd.next !== pwd.confirm) errors.confirm = 'Passwords do not match.';
    setPwdErrors(errors);
    if (Object.keys(errors).length) return;

    setPwdSaving(true);
    try {
      // Step 1 — verify the CURRENT password against the auth provider.
      // signInWithPassword only replaces the session on success, so a wrong
      // password leaves the customer signed in.
      const { data: userData } = await supabase.auth.getUser();
      const email = userData?.user?.email || user?.email;
      if (!email) throw new Error('Unable to update password. Please try again.');
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: pwd.current,
      });
      if (signInError) {
        setPwdErrors({ current: 'Current password is incorrect.' });
        setPwdSaving(false);
        return;
      }
      // Step 2 — update the password inside Supabase Auth (never in the ATANY DB).
      const { error: updateError } = await supabase.auth.updateUser({ password: pwd.next });
      if (updateError) {
        setPwdErrors({ next: 'Unable to update password. Please try again.' });
        setPwdSaving(false);
        return;
      }
      setPwd({ current: '', next: '', confirm: '' });
      setPwdErrors({});
      // restore every password field to the hidden state
      setPwdResetToken((t) => t + 1);
      showToast('Password updated successfully.');
    } catch {
      setPwdErrors({ next: 'Unable to update password. Please try again.' });
    } finally {
      setPwdSaving(false);
    }
  };

  // Safe, customer-visible context for the support request. The backend
  // whitelists these keys and drops anything credential-shaped.
  const buildSupportMetadata = useCallback(() => {
    if (supportParams.get('support') !== 'expired-payment') return null;
    const item = supportParams.get('item');
    const transactionCode = supportParams.get('order');
    const expiredPaymentDeadline = supportParams.get('deadline');
    const winningAmount = supportParams.get('amount');
    const meta = {};
    if (item) meta.item = item;
    if (transactionCode) meta.transaction_code = transactionCode;
    if (expiredPaymentDeadline) meta.expired_payment_deadline = expiredPaymentDeadline;
    if (winningAmount) meta.winning_amount = winningAmount;
    return Object.keys(meta).length ? meta : null;
  }, [supportParams]);

  // ── Support deep-link prefill ────────────────────────────────────────────
  // /customer/account?support=expired-payment&order=…&item=…&deadline=…&amount=…
  // opens the Contact Us modal with the SAFE, customer-visible context only.
  // The next bidder's identity is never part of the payload.
  useEffect(() => {
    if (supportParams.get('support') !== 'expired-payment') return;
    const item = supportParams.get('item') || '';
    const orderRef = supportParams.get('order') || '';
    const deadline = supportParams.get('deadline') || '';
    const amount = supportParams.get('amount') || '';
    const lines = [
      'Hello ATANY Support,',
      '',
      'I have a question about the payment period that ended on one of my auction orders.',
      '',
    ];
    if (item) lines.push(`Item: ${item}`);
    if (orderRef) lines.push(`Order: ${orderRef}`);
    if (deadline) lines.push(`Expired payment deadline: ${deadline}`);
    if (amount) lines.push(`My former winning amount: ${amount}`);
    lines.push('', 'Please let me know what happens next. Thank you.');
    setContactCategory('Auction / Payment Support');
    setContactMessage(lines.join('\n'));
    setContactOpen(true);
  }, [supportParams]);

  const handleContactSend = async () => {
    const message = contactMessage.trim();
    if (!message) {
      setContactError('Please enter a message.');
      return;
    }
    setContactSending(true);
    setContactError(null);
    try {
      const res = await apiFetch('/customer/support', {
        method: 'POST',
        body: JSON.stringify({
          category: contactCategory,
          subject: contactSubject || contactCategory,
          message,
          // Safe, customer-visible context only (whitelisted server-side).
          metadata: buildSupportMetadata(),
        }),
      });
      if (!res) throw new Error('Unable to send your support request. Please try again.');
      setContactReference(res?.request?.reference || '');
      setContactMailSent(res?.email_notification?.sent !== false);
      setContactMessage('');
      setContactOpen(false);
      showToast('Support request sent');
    } catch (e) {
      setContactError(e?.message || 'Unable to send your support request. Please try again.');
    } finally {
      setContactSending(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-skeleton" style={{ height: 280 }} />
        <div className="profile-skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="profile-page">
        <div className="panel">
          <div className="empty-state">
            <p style={{ color: 'var(--danger)' }}>Unable to load your profile: {loadError}</p>
            <button className="btn btn-primary" onClick={load}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      {/* Top row: Personal Information | Security */}
      <div className="profile-top">
        {/* Personal Information */}
        <section className="panel profile-card">
          <div className="panel-head">
            <div>
              <h2>Personal Information</h2>
              <p>Update your personal details.</p>
            </div>
          </div>
          <div className="profile-card__body">
            {isSuspended && (
              <div className="profile-suspended" role="status">
                <strong>Your account is suspended.</strong>{' '}
                Profile changes are paused while the team reviews your account. You can still reach our support
                team from <Link to="/account-suspended">Account Status</Link>.
              </div>
            )}
            <div className="form-row">
              <label htmlFor="profile-name">Full Name</label>
              <div className="profile-input-wrap">
                <User size={15} aria-hidden="true" className="profile-input-wrap__icon" />
                <input
                  id="profile-name"
                  name="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Your full name"
                />
              </div>
              {fieldErrors.name && <p className="wizard-field-error">{fieldErrors.name}</p>}
            </div>

            <div className="form-row">
              <label htmlFor="profile-email">Email Address</label>
              <div className="profile-input-wrap">
                <Mail size={15} aria-hidden="true" className="profile-input-wrap__icon" />
                <input
                  id="profile-email"
                  name="email"
                  value={account?.email || ''}
                  readOnly
                  disabled
                  autoComplete="email"
                  title="Your account email cannot be changed here"
                />
              </div>
              <p className="form-hint">Account email — read-only.</p>
            </div>

            <div className="form-row">
              <label htmlFor="profile-phone">Phone Number</label>
              <div className="profile-input-wrap">
                <Phone size={15} aria-hidden="true" className="profile-input-wrap__icon" />
                <input
                  id="profile-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+63 9XX XXX XXXX"
                />
              </div>
              {fieldErrors.phone && <p className="wizard-field-error">{fieldErrors.phone}</p>}
            </div>

            <div className="form-row">
              <label htmlFor="profile-branch">Preferred Branch</label>
              <div className="profile-input-wrap">
                <MapPin size={15} aria-hidden="true" className="profile-input-wrap__icon" />
                <select
                  id="profile-branch"
                  name="preferred_branch_id"
                  value={form.branchId}
                  onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                  disabled={branchOptions.length === 0}
                >
                  {branchOptions.length === 0 && <option value="">No branches available</option>}
                  {branchOptions.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <p className="form-hint">Where you collect your lot. You can change this any time.</p>
            </div>

            <div className="profile-card__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving || isSuspended}
                aria-busy={saving ? 'true' : undefined}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="panel profile-card">
          <div className="panel-head">
            <div>
              <h2>Security</h2>
              <p>Manage your password.</p>
            </div>
          </div>
          <div className="profile-card__body">
            <PasswordField
              label="Current Password"
              name="currentPassword"
              value={pwd.current}
              onChange={(v) => setPwd((p) => ({ ...p, current: v }))}
              autoComplete="current-password"
              error={pwdErrors.current}
              disabled={pwdSaving}
              resetToken={pwdResetToken}
            />
            <PasswordField
              label="New Password"
              name="newPassword"
              value={pwd.next}
              onChange={(v) => setPwd((p) => ({ ...p, next: v }))}
              autoComplete="new-password"
              error={pwdErrors.next}
              disabled={pwdSaving}
              resetToken={pwdResetToken}
            />
            <PasswordField
              label="Confirm New Password"
              name="confirmPassword"
              value={pwd.confirm}
              onChange={(v) => setPwd((p) => ({ ...p, confirm: v }))}
              autoComplete="new-password"
              error={pwdErrors.confirm}
              disabled={pwdSaving}
              resetToken={pwdResetToken}
            />
            <div className="profile-card__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePasswordChange}
                disabled={pwdSaving}
                aria-busy={pwdSaving ? 'true' : undefined}
              >
                {pwdSaving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
            <p className="form-hint">Your password is stored securely by our authentication provider — never in our database.</p>
          </div>
        </section>
      </div>

      {/* Help & Support — full width */}
      <section className="panel profile-card profile-support">
        <div className="panel-head">
          <div>
            <h2>Help &amp; Support</h2>
            <p>Get help when you need it.</p>
          </div>
        </div>
        <div className="profile-support__rows">
          <button type="button" className="profile-support__row" onClick={() => setFaqOpen(true)}>
            <span className="profile-support__icon"><FileText size={17} aria-hidden="true" /></span>
            <span className="profile-support__text">
              <span className="profile-support__title">FAQ</span>
              <span className="profile-support__desc">Find answers to common questions.</span>
            </span>
            <ChevronRight size={16} className="profile-support__chev" aria-hidden="true" />
          </button>

          <button type="button" className="profile-support__row" onClick={() => { setContactOpen(true); setContactError(null); }}>
            <span className="profile-support__icon"><Send size={17} aria-hidden="true" /></span>
            <span className="profile-support__text">
              <span className="profile-support__title">Contact Us</span>
              <span className="profile-support__desc">Reach our support team at {SUPPORT_EMAIL}.</span>
            </span>
            <ChevronRight size={16} className="profile-support__chev" aria-hidden="true" />
          </button>
        </div>
        {contactReference && (
          <div className="profile-support__last" role="status">
            <strong>Support request sent</strong> — we've received your message. ATANY Support will review your request.
            <br />
            Reference: <strong>{contactReference}</strong>
            {!contactMailSent && (
              <>
                <br />
                Email notification is temporarily delayed — you can also email{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>{SUPPORT_EMAIL}</a>.
              </>
            )}
          </div>
        )}
      </section>

      {/* FAQ modal */}
      {faqOpen && (
        <div className="profile-modal-overlay" role="presentation" onClick={() => setFaqOpen(false)}>
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-faq-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-modal__head">
              <h3 id="profile-faq-title"><HelpCircle size={17} aria-hidden="true" /> Frequently Asked Questions</h3>
              <button type="button" className="modal-close" onClick={() => setFaqOpen(false)} aria-label="Close FAQ">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="profile-modal__body">
              {FAQ_ITEMS.map((item) => (
                <details key={item.q} className="profile-faq">
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
              <p className="form-hint">
                Still need help? Use <strong>Contact Us</strong> below, or visit our{' '}
                <Link to="/customer/branch-locator">Branch Locator</Link>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Contact Us modal */}
      {contactOpen && (
        <div className="profile-modal-overlay" role="presentation" onClick={() => !contactSending && setContactOpen(false)}>
          <div
            className="profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-contact-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profile-modal__head">
              <h3 id="profile-contact-title"><Send size={17} aria-hidden="true" /> Contact Us</h3>
              <button type="button" className="modal-close" onClick={() => setContactOpen(false)} aria-label="Close contact form" disabled={contactSending}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="profile-modal__body">
              <p className="form-hint">
                Signed in as <strong>{account?.name}</strong> ({account?.email}). You can also{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>email us directly</a>.
              </p>
              <div className="form-row">
                <label htmlFor="profile-contact-category">Category</label>
                <select
                  id="profile-contact-category"
                  value={contactCategory}
                  onChange={(e) => setContactCategory(e.target.value)}
                  disabled={contactSending}
                >
                  {SUPPORT_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="profile-contact-subject">Subject</label>
                <input
                  id="profile-contact-subject"
                  value={contactSubject}
                  onChange={(e) => setContactSubject(e.target.value)}
                  disabled={contactSending}
                  maxLength={200}
                  placeholder="Short summary"
                />
              </div>
              <div className="form-row">
                <label htmlFor="profile-contact-message">Message</label>
                <textarea
                  id="profile-contact-message"
                  rows={5}
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  placeholder="How can we help?"
                  maxLength={5000}
                  disabled={contactSending}
                />
              </div>
              {contactError && <p className="wizard-field-error">{contactError}</p>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleContactSend}
                disabled={contactSending}
                aria-busy={contactSending ? 'true' : undefined}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {contactSending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Profile;
