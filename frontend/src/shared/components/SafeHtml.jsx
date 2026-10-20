// frontend/src/shared/components/SafeHtml.jsx
// QA b XSS hardening — replaces dangerouslySetInnerHTML for activity/notification text.
// Legacy data (admin.html:1651, customer-dashboard.html:610) stored HTML like "John placed <b>₱268,000 bid</b>".
// We allow only <b> tags; everything else is escaped to prevent XSS from user-controlled names.
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function SafeHtml({ html }) {
  // Escape then re-allow <b> and </b> only
  const escaped = escapeHtml(html).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
  // Use DOM to verify no other tags remain — if any < remains, escape it
  if (/<(?!\/?b>)/.test(escaped)) {
    // Fallback: render as plain text if unexpected tags detected
    return <span>{html.replace(/<[^>]*>/g, '')}</span>;
  }
  return <span dangerouslySetInnerHTML={{ __html: escaped }} />;
}

// Alternative for explicit bold segments without HTML — preferred for new code
export function ActivityText({ text }) {
  const parts = text.split(/(<b>.*?<\/b>)/g);
  return (
    <span className="activity-text">
      {parts.map((p, i) =>
        p.startsWith('<b>') ? <b key={i} style={{ color: 'var(--navy)' }}>{p.slice(3, -4)}</b> : <span key={i}>{p}</span>
      )}
    </span>
  );
}
