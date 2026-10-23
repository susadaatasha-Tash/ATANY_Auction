// frontend/src/shared/components/SupportRequestForm.jsx
// ─────────────────────────────────────────────────────────────────────────────
// ONE frontend implementation of the ATANY support request form.
//
// Every surface that lets a person ask ATANY for help uses this component:
//   • the public landing contact form (its own inline form, same contract)
//   • Customer Profile → Help & Support
//   • Shop Owner → Shop Profile → Contact ATANY Support
//   • Account Suspended → Contact ATANY Support
//
// It POSTs to the shared backend support service, which persists the request
// and notifies the official ATANY inbox. It never fabricates a success state:
// when the backend reports that the email notification was delayed, the form
// says so and offers the official address as a fallback.
import { useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useToast } from './Toast';
import { SUPPORT_EMAIL, SUPPORT_CATEGORIES } from '../config/support';

export default function SupportRequestForm({
  endpoint = '/support/account',
  categories = SUPPORT_CATEGORIES,
  initialCategory = 'General Inquiry',
  initialSubject = '',
  initialMessage = '',
  submitLabel = 'Send Support Request',
  metadata = null,
  onSent,
  showCategory = true,
  showSubject = true,
}) {
  // The toast is a nicety — a surface without a ToastProvider must still work.
  let showToast = () => {};
  try {
    showToast = useToast();
  } catch {
    showToast = () => {};
  }
  const [category, setCategory] = useState(initialCategory);
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState(initialMessage);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    if (!message.trim()) {
      setError('Please enter a message.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          category,
          subject: showSubject ? subject : category,
          message: message.trim(),
          ...(metadata ? { metadata } : {}),
        }),
      });
      if (!res) throw new Error('Unable to send your support request. Please try again.');
      const reference = res?.request?.reference || '';
      const mailSent = res?.email_notification?.sent !== false;
      setResult({ reference, mailSent });
      setMessage('');
      showToast('Support request sent');
      if (onSent) onSent({ reference, mailSent });
    } catch (err) {
      setError(err?.message || 'Unable to send your support request. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <p className="form-hint">
        Your request goes to ATANY Support at <strong>{SUPPORT_EMAIL}</strong>.
      </p>
      {showCategory && (
        <div className="form-row">
          <label htmlFor="support-category">Category</label>
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={sending}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      )}

      {showSubject && (
        <div className="form-row">
          <label htmlFor="support-subject">Subject</label>
          <input
            id="support-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
            maxLength={200}
            placeholder="Short summary"
          />
        </div>
      )}

      <div className="form-row">
        <label htmlFor="support-message">Message</label>
        <textarea
          id="support-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
          maxLength={5000}
          placeholder="How can we help?"
        />
      </div>

      {error && (
        <p className="wizard-field-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div role="status" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 700 }}>
            Support request sent
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
            We've received your message. ATANY Support will review your request.
            {result.reference ? (
              <>
                <br />
                Reference: <strong>{result.reference}</strong>
              </>
            ) : null}
            {!result.mailSent && (
              <>
                <br />
                Email notification is temporarily delayed — you can also reach us at{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: 'var(--navy)', fontWeight: 700 }}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </>
            )}
          </div>
        </div>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', minHeight: 46, justifyContent: 'center' }}
        disabled={sending}
        aria-busy={sending ? 'true' : undefined}
      >
        {sending ? 'Sending…' : submitLabel}
      </button>
    </form>
  );
}
