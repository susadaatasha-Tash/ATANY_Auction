// frontend/src/roles/customer/pages/AccountSettings.jsx
// frontend/src/roles/customer/pages/AccountSettings.jsx
//
// Customer Profile (/customer/account) — real, self-service account management.
//
// This page is the canonical customer account surface after the old Settings page
// was retired. Three sections:
//
//   1. PROFILE INFORMATION  — Full Name, Email (read-only), Phone, Preferred Branch
//   2. SECURITY             — Current / New / Confirm password + Eye toggles
//   3. HELP & SUPPORT       — FAQ (accordion) + Contact Us (real support flow)
//
// WHAT IS ACTUALLY PERSISTED
// --------------------------
// · Full Name  → PUT /customer/account (public.users.name, the canonical row)
//                + Supabase Auth user_metadata, because the header/avatar read
//                the display name from user_metadata. Updating both keeps the
//                header in sync immediately, with no reload or re-login.
// · Phone      → PUT /customer/account (public.users.phone)
// · Branch     → PUT /customer/preferred-branch (existing dedicated endpoint)
// · Password   → Supabase Auth ONLY. The current password is proven by
//                re-authenticating with signInWithPassword before updateUser.
//                The password is never sent to the ATANY backend or stored in
//                any ATANY table.
//
// Email is deliberately read-only: ATANY has no verified email-change flow, so
// silently overwriting users.email would be an unverified identity change.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Eye, EyeOff, ChevronDown, ChevronRight, HelpCircle, Mail, X, FileText, Headphones, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../../shared/lib/apiClient';
import { useToast } from '../../../shared/components/Toast';
import { useAuth } from '../../../shared/hooks/useAuth';
import { supabase } from '../../../shared/lib/supabaseClient';
import { uploadSupportAttachment, validateSupportImage, SUPPORT_IMAGE_ACCEPT, SUPPORT_IMAGE_HINT } from '../../../shared/lib/supportAttachment';

const PHONE_HINT = '+63 9XX XXX XXXX';
const MIN_PASSWORD_LENGTH = 6;

/**
 * Accepts the formats people actually type and returns a canonical
 * `+63XXXXXXXXX`, or null when the value cannot be a Philippine mobile.
 * Mirrors the backend rule so the customer gets instant feedback; the server
 * remains authoritative.
 */
export function normalizePhoneInput(raw) {
  const cleaned = String(raw || '').replace(/[\s().-]/g, '');
  if (!cleaned) return null;
  // Three accepted shapes, each with the correct digit count:
  //   +63 + 10 national digits | 09 + 9 | 9 + 9
  if (!/^(\+?63\d{10}|09\d{9}|9\d{9})$/.test(cleaned)) return undefined; // undefined = invalid
  let digits = cleaned.replace(/^\+/, '');
  if (digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 || !digits.startsWith('9')) return undefined;
  return `+63${digits}`;
}

/** Friendly, re-validates before we ever hit the network. */
export function validatePhoneInput(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { ok: true, value: '' }; // optional
  const normalized = normalizePhoneInput(value);
  if (normalized === undefined) return { ok: false, message: 'Enter a valid Philippine mobile number.' };
  return { ok: true, value: normalized };
}

/** Shared password policy — mirrors signup expectations. */
export function validatePasswordChange({ current, next, confirm }) {
  if (!current) return { ok: false, message: 'Enter your current password.' };
  if (!next) return { ok: false, message: 'Enter a new password.' };
  if (next.length < MIN_PASSWORD_LENGTH) return { ok: false, message: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (next === current) return { ok: false, message: 'New password must be different from your current password.' };
  if (next !== confirm) return { ok: false, message: 'Passwords do not match.' };
  return { ok: true };
}

/** Eye toggle that keeps its own visibility state, independent per field. */
function PasswordField({ id, label, value, onChange, visible, onToggle, autoComplete, placeholder, error }) {
  return (
    <div className="form-row">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className={error ? 'has-error' : ''}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={onToggle}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          title={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

/** Grounded only in behaviour ATANY actually implements. */
const FAQ_ITEMS = [
  {
    q: 'How does bidding work?',
    a: 'Open Auctions, pick a live lot, and enter at least the minimum next bid shown on that lot. You can raise your bid at any time while the auction is live, and you are notified when you are outbid.',
  },
  {
    q: 'What happens when an auction ends?',
    a: 'When the auction ends, the highest eligible bidder becomes the current winner and receives a 7-day window to complete payment.',
  },
  {
    q: 'What if I do not pay within 7 days?',
    a: 'If payment is not completed within the 7-day window, the opportunity may pass to the next highest eligible bidder, who then gets a fresh 7-day window. Payment windows are per order, not shared.',
  },
  {
    q: 'Where do I collect my piece?',
    a: 'Collection is pickup-only at your selected ATANY branch. Once payment is confirmed and your order is prepared, bring valid ID and your order number to the branch.',
  },
  {
    q: 'How do I pay?',
    a: 'You can pay from My Purchases using the secure payment link issued for your order. Some orders can also be settled at a branch counter.',
  },
  {
    q: 'Why was my account suspended?',
    a: 'An account can be suspended by ATANY administration. While suspended you cannot bid or access customer features. Use Contact Us below and an administrator will explain the reason and the next steps.',
  },
];

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="profile-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="profile-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={wide ? { width: 'min(620px, 100%)' } : undefined}
      >
        <div className="profile-modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="profile-modal-body">{children}</div>
      </div>
    </div>
  );
}

export default function AccountSettings({ branches: propBranches }) {
  const showToast = useToast();
  const { user, setPreferredBranchId } = useAuth();

  const [branches, setBranches] = useState(propBranches || []);
  const [branchesLoading, setBranchesLoading] = useState(!propBranches?.length);
  const [branchesError, setBranchesError] = useState(false);

  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [branchId, setBranchId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [showPwd, setShowPwd] = useState({ current: false, next: false, confirm: false });
  const [pwdError, setPwdError] = useState(null);
  const [pwdSaving, setPwdSaving] = useState(false);

  const [faqOpen, setFaqOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [contactOpen, setContactOpen] = useState(false);
  const [contact, setContact] = useState({ subject: '', message: '' });
  const [contactErrors, setContactErrors] = useState({});
  const [contactSending, setContactSending] = useState(false);
  const [contactSent, setContactSent] = useState(false);
  const [contactAttachment, setContactAttachment] = useState(null);   // { file, path, name }
  const [contactAttachmentError, setContactAttachmentError] = useState(null);

  /* ── load: authoritative profile + real branches ─────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const acct = await apiFetch('/customer/account');
      setAccount(acct);
      setForm({ name: acct.name || '', email: acct.email || '', phone: acct.phone || '' });
      setBranchId(acct.preferred_branch_id || '');
    } catch (e) {
      setLoadError(e?.message || 'Unable to load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (propBranches?.length) { setBranches(propBranches); setBranchesLoading(false); return; }
    let cancelled = false;
    setBranchesLoading(true);
    // Same authoritative source as /branches and the landing page. A failure
    // must never wipe the branch already shown on the account.
    apiFetch('/branches', { public: true })
      .then((rows) => { if (!cancelled) setBranches(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setBranchesError(true); })
      .finally(() => { if (!cancelled) setBranchesLoading(false); });
    return () => { cancelled = true; };
  }, [propBranches]);

  const dirty = useMemo(() => {
    if (!account) return false;
    return (
      form.name.trim() !== (account.name || '') ||
      form.phone !== (account.phone || '') ||
      branchId !== (account.preferred_branch_id || '')
    );
  }, [form, branchId, account]);

  /* ── save profile (name + phone) and preferred branch ─────────────────── */
  const handleSave = async () => {
    const errors = {};
    if (form.name.trim().length < 2) errors.name = 'Enter your full name.';
    const phoneCheck = validatePhoneInput(form.phone);
    if (!phoneCheck.ok) errors.phone = phoneCheck.message;
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    const branchChanged = branchId !== (account.preferred_branch_id || '');

    setSaving(true);
    setSaved(false);
    try {
      // 1) Profile fields through the dedicated profile endpoint. Only values
      //    the customer actually changed are sent, so we never write back stale
      //    fields from a stale render.
      const payload = {};
      if (form.name.trim() !== (account.name || '')) payload.name = form.name.trim();
      // Send the canonical value we just validated (+639XXXXXXXXX) so the stored
      // format always matches what the field displays.
      if (phoneCheck.value !== (account.phone || '')) payload.phone = phoneCheck.value;

      let updatedProfile = account;
      if (Object.keys(payload).length) {
        const res = await apiFetch('/customer/account', { method: 'PUT', body: JSON.stringify(payload) });
        updatedProfile = res?.profile || account;
      }

      // 2) Preferred branch keeps its own endpoint, as the architecture intends.
      if (branchChanged) {
        const res = await apiFetch('/customer/preferred-branch', {
          method: 'PUT',
          body: JSON.stringify({ branch_id: branchId || null }),
        });
        // Keep the header in sync immediately — no reload, no re-login.
        setPreferredBranchId?.(res?.preferred_branch_id || null);
      }

      const nextAccount = {
        ...account,
        name: updatedProfile.name ?? form.name.trim(),
        phone: updatedProfile.phone ?? (phoneCheck.value || null),
        preferred_branch_id: branchId || null,
        preferred_branch_name:
          branches.find((b) => b.id === branchId)?.name ?? updatedProfile.preferred_branch_name ?? null,
      };
      setAccount(nextAccount);
      setForm({ name: nextAccount.name, email: account.email, phone: nextAccount.phone || '' });

      // The header + avatar read the display name from Supabase user_metadata,
      // so mirror the new name there to keep them in sync (§ header sync).
      if (payload.name !== undefined) {
        try { await supabase.auth.updateUser({ data: { name: payload.name } }); } catch { /* header refreshes on next auth event */ }
      }

      setSaved(true);
      showToast('Profile updated successfully.');
    } catch (e) {
      // Keep the customer's unsaved edits so they can retry.
      showToast(e?.message || 'Unable to update profile.');
    } finally {
      setSaving(false);
    }
  };

  /* ── security: prove the current password, then change it in Supabase ─── */
  const handlePasswordUpdate = async () => {
    const check = validatePasswordChange(pwd);
    if (!check.ok) { setPwdError(check.message); return; }
    setPwdError(null);
    setPwdSaving(true);
    try {
      const email = user?.email || account?.email;
      if (!email) { setPwdError('Unable to update password. Please try again.'); return; }

      // Prove the CURRENT password by re-authenticating. A wrong password fails
      // here and the new password is never sent anywhere.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: pwd.current,
      });
      if (reauthError) {
        setPwdError('Current password is incorrect.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: pwd.next });
      if (updateError) {
        setPwdError(updateError.message === 'Password should be at least 6 characters.'
          ? 'New password does not meet requirements.'
          : 'Unable to update password. Please try again.');
        return;
      }

      setPwd({ current: '', next: '', confirm: '' });
      setShowPwd({ current: false, next: false, confirm: false });
      showToast('Password updated successfully.');
    } catch {
      setPwdError('Unable to update password. Please try again.');
    } finally {
      setPwdSaving(false);
    }
  };

  /* ── help & support ───────────────────────────────────────────────────── */
  /** Customer attachments use the AUTHENTICATED endpoint (session-scoped path). */
  const handleSupportAttachmentPick = async (e) => {
    const file = e.target.files?.[0] || null;
    setContactAttachmentError(null);
    if (!file) { setContactAttachment(null); return; }
    const invalid = validateSupportImage(file);
    if (invalid) {
      setContactAttachment(null);
      setContactAttachmentError(invalid);
      e.target.value = '';
      return;
    }
    try {
      const path = await uploadSupportAttachment(file, { authenticated: true });
      setContactAttachment({ file, path, name: file.name });
    } catch (err) {
      setContactAttachment(null);
      setContactAttachmentError(err?.message || 'We could not upload your image. Please try again.');
      e.target.value = '';
    }
  };

  const sendSupport = async () => {
    const errors = {};
    if (!contact.subject.trim()) errors.subject = 'Please choose a subject.';
    if (contact.message.trim().length < 5) errors.message = 'Please tell us a little more.';
    setContactErrors(errors);
    if (Object.keys(errors).length) return;

    setContactSending(true);
    try {
      // Upload first (best effort): a failed image must never lose the message.
      let attachmentPath = null;
      if (contactAttachment?.file) {
        try {
          attachmentPath = await uploadSupportAttachment(contactAttachment.file, { authenticated: true });
        } catch (uploadErr) {
          setContactAttachmentError(uploadErr?.message || 'We could not attach your image.');
        }
      }
      // Real support flow: authenticated backend endpoint that derives identity
      // from the session and writes a support_requests row.
      await apiFetch('/customer/support', {
        method: 'POST',
        body: JSON.stringify({
          subject: contact.subject.trim(),
          message: contact.message.trim(),
          ...(attachmentPath ? { attachment_path: attachmentPath } : {}),
        }),
      });
      setContactSent(true);
      setContact({ subject: '', message: '' });
      setContactAttachment(null); setContactAttachmentError(null);
      showToast('Your request has been submitted successfully.');
    } catch (e) {
      showToast(e?.message || 'Something went wrong — please try again.');
    } finally {
      setContactSending(false);
    }
  };

  if (loading) {
    return (
      <div className="panel">
        <div className="empty-state"><p>Loading your profile…</p></div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="panel">
        <div className="empty-state" style={{ color: 'var(--danger)' }}>
          <p>{loadError}</p>
          <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="profile-grid">
        {/* ── PROFILE INFORMATION ─────────────────────────────────────── */}
        <div className="panel profile-info-panel">
          <div className="panel-head">
            <div>
              <h2>Profile Information</h2>
              <p>Keep your contact details current for bid and pickup updates.</p>
            </div>
            {saved && !saving && <span className="profile-saved-flag">Saved</span>}
          </div>

          <div className="profile-panel-body">
            <div className="form-row">
              <label htmlFor="pf-name">Full Name</label>
              <input
                id="pf-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoComplete="name"
                className={fieldErrors.name ? 'has-error' : ''}
              />
              {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
            </div>

            <div className="form-row">
              <label htmlFor="pf-email">Email Address</label>
              <input
                id="pf-email"
                value={form.email}
                readOnly
                disabled
                autoComplete="email"
                title="Your account email cannot be changed here"
                className="read-only-field"
              />
              <span className="field-hint">Account email — used for sign-in and receipts. Contact support to change it.</span>
            </div>

            <div className="form-row">
              <label htmlFor="pf-phone">Phone Number</label>
              <input
                id="pf-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder={PHONE_HINT}
                inputMode="tel"
                autoComplete="tel"
                className={fieldErrors.phone ? 'has-error' : ''}
              />
              {fieldErrors.phone
                ? <span className="field-error">{fieldErrors.phone}</span>
                : <span className="field-hint">Optional. Philippine mobile, e.g. {PHONE_HINT}.</span>}
            </div>

            <div className="form-row">
              <label htmlFor="pf-branch">Preferred Branch</label>
              <select
                id="pf-branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={branchesLoading || branches.length === 0}
              >
                {branchesLoading && <option value="">Loading branches…</option>}
                {!branchesLoading && branches.length === 0 && <option value="">No branches available</option>}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {branchesError
                ? <span className="field-hint">Branch list unavailable — your saved branch is still shown.</span>
                : <span className="field-hint">Where you collect your pieces. Pickup-only, no delivery.</span>}
            </div>

            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* ── SECURITY ────────────────────────────────────────────────── */}
        <div className="panel profile-security-panel">
          <div className="panel-head">
            <div>
              <h2>Security</h2>
              <p>Change your password. You stay signed in afterwards.</p>
            </div>
          </div>

          <div className="profile-panel-body">
            <PasswordField
              id="pf-pwd-current"
              label="Current Password"
              value={pwd.current}
              onChange={(v) => setPwd({ ...pwd, current: v })}
              visible={showPwd.current}
              onToggle={() => setShowPwd({ ...showPwd, current: !showPwd.current })}
              autoComplete="current-password"
              placeholder="••••••••"
            />
            <PasswordField
              id="pf-pwd-new"
              label="New Password"
              value={pwd.next}
              onChange={(v) => setPwd({ ...pwd, next: v })}
              visible={showPwd.next}
              onToggle={() => setShowPwd({ ...showPwd, next: !showPwd.next })}
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />
            <PasswordField
              id="pf-pwd-confirm"
              label="Confirm New Password"
              value={pwd.confirm}
              onChange={(v) => setPwd({ ...pwd, confirm: v })}
              visible={showPwd.confirm}
              onToggle={() => setShowPwd({ ...showPwd, confirm: !showPwd.confirm })}
              autoComplete="new-password"
              placeholder="Repeat your new password"
            />

            {pwdError && <div className="profile-alert error" role="alert">{pwdError}</div>}

            <button
              className="btn btn-primary"
              onClick={handlePasswordUpdate}
              disabled={pwdSaving || !pwd.current || !pwd.next || !pwd.confirm}
            >
              {pwdSaving ? 'Updating…' : 'Update Password'}
            </button>
            <p className="field-hint" style={{ marginTop: 10 }}>
              <ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              Passwords are managed by ATANY's authentication provider and are never stored in your account record.
            </p>
          </div>
        </div>
      </div>

      {/* ── HELP & SUPPORT (moved from the retired Settings page) ───────── */}
      <div className="panel profile-help-panel">
        <div className="panel-head">
          <div>
            <h2>Help &amp; Support</h2>
            <p>Get help when you need it.</p>
          </div>
        </div>
        <div className="profile-panel-body">
          <button type="button" className="profile-help-row" onClick={() => setFaqOpen(true)}>
            <span className="profile-help-icon"><FileText size={16} /></span>
            <span className="profile-help-text">
              <span className="profile-help-title">FAQ</span>
              <span className="profile-help-desc">Find answers to common questions.</span>
            </span>
            <ChevronRight size={16} className="profile-help-chevron" />
          </button>

          <button type="button" className="profile-help-row" onClick={() => { setContactOpen(true); setContactSent(false); }}>
            <span className="profile-help-icon"><Mail size={16} /></span>
            <span className="profile-help-text">
              <span className="profile-help-title">Contact Us</span>
              <span className="profile-help-desc">Reach our support team.</span>
            </span>
            <ChevronRight size={16} className="profile-help-chevron" />
          </button>
        </div>
      </div>

      {faqOpen && (
        <Modal title="Frequently Asked Questions" onClose={() => setFaqOpen(false)} wide>
          <div className="profile-faq">
            {FAQ_ITEMS.map((item, i) => (
              <div key={item.q} className={`profile-faq-item ${openFaq === i ? 'open' : ''}`}>
                <button type="button" onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}>
                  <span>{item.q}</span>
                  <ChevronDown size={15} />
                </button>
                {openFaq === i && <p>{item.a}</p>}
              </div>
            ))}
          </div>
        </Modal>
      )}

      {contactOpen && (
        <Modal title="Contact Us" onClose={() => setContactOpen(false)}>
          {contactSent ? (
            <div className="profile-contact-sent">
              <HelpCircle size={28} />
              <h4>Request Submitted</h4>
              <p>Your request has been submitted successfully. Our team will review it as soon as possible. For urgent bid or pickup matters you can also raise it in person at your ATANY branch.</p>
              <button className="btn btn-outline" onClick={() => setContactOpen(false)}>Close</button>
            </div>
          ) : (
            <div className="profile-contact-form">
              <p className="profile-contact-prefill">
                Sending as <strong>{form.name}</strong> ({form.email})
              </p>
              <div className="form-row">
                <label htmlFor="cs-subject">Subject</label>
                <select
                  id="cs-subject"
                  value={contact.subject}
                  onChange={(e) => setContact({ ...contact, subject: e.target.value })}
                  className={contactErrors.subject ? 'has-error' : ''}
                >
                  <option value="">Choose a subject…</option>
                  {['General Inquiry', 'Bid Support', 'Payout Question', 'Account Issue', 'Partnership'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                {contactErrors.subject && <span className="field-error">{contactErrors.subject}</span>}
              </div>
              <div className="form-row">
                <label htmlFor="cs-message">Message</label>
                <textarea
                  id="cs-message"
                  rows={5}
                  value={contact.message}
                  onChange={(e) => setContact({ ...contact, message: e.target.value })}
                  placeholder="How can we help?"
                  className={contactErrors.message ? 'has-error' : ''}
                />
                {contactErrors.message && <span className="field-error">{contactErrors.message}</span>}
              </div>
              <div className="form-row">
                <label htmlFor="cs-attachment">Attach Image (optional)</label>
                <input
                  id="cs-attachment"
                  type="file"
                  accept={SUPPORT_IMAGE_ACCEPT}
                  onChange={handleSupportAttachmentPick}
                  style={{ fontSize: 12 }}
                />
                {contactAttachmentError
                  ? <span className="field-error">{contactAttachmentError}</span>
                  : contactAttachment
                    ? <span className="field-hint">Attached: {contactAttachment.name}</span>
                    : <span className="field-hint">{SUPPORT_IMAGE_HINT}</span>}
              </div>
              <button className="btn btn-primary" onClick={sendSupport} disabled={contactSending}>
                {contactSending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
