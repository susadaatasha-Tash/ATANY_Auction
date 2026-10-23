// frontend/src/roles/shop-owner/subscription/PaymentMethodMarks.jsx
// Payment-method brand marks — pure SVG/CSS wordmarks (no emoji, no remote
// images, no mixed icon libraries). Every mark is decorative (aria-hidden);
// the accessible name always comes from the surrounding row/label.
import React from 'react';

/** GCash — blue rounded square with the "G" monogram. */
export function GCashMark({ size = 28 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: '#0074E0',
        color: '#fff',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: Math.round(size * 0.58),
        fontWeight: 800,
        letterSpacing: '-.03em',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      G
    </span>
  );
}

/** Maya — dark rounded square with the wordmark. */
export function MayaMark({ size = 28 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: '#1B3B2F',
        color: '#7BE0B0',
        display: 'inline-grid',
        placeItems: 'center',
        fontSize: Math.round(size * 0.34),
        fontWeight: 800,
        letterSpacing: '-.04em',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      maya
    </span>
  );
}

/** QR Ph — the QR Ph brand lockup. */
export function QRPhMark({ size = 28 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
        color: '#1B1B1B',
        fontWeight: 800,
        fontSize: Math.round(size * 0.42),
        letterSpacing: '-.03em',
      }}
    >
      <svg width={Math.round(size * 0.82)} height={Math.round(size * 0.82)} viewBox="0 0 24 24" fill="none" stroke="#F26A21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M14 14h3v3h-3z" />
        <path d="M21 14v3" />
        <path d="M18 21h3" />
      </svg>
      <span>QRPh</span>
    </span>
  );
}

/** A generic card icon used for the Card method row. */
export function CardGlyph({ size = 28 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: 'var(--navy)',
        color: '#fff',
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </svg>
    </span>
  );
}

/** The card-network marks shown next to the Card option. */
export function CardNetworkMarks({ size = 20 }) {
  const marks = [
    { label: 'VISA', color: '#1A1F71', text: 'VISA' },
    { label: 'Mastercard', color: '#EB001B', text: 'MC' },
    { label: 'American Express', color: '#0077A6', text: 'AMEX' },
    { label: 'JCB', color: '#0E4C96', text: 'JCB' },
  ];
  return (
    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {marks.map((m) => (
        <span
          key={m.label}
          title={m.label}
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            height: Math.round(size * 0.86),
            minWidth: Math.round(size * 1.5),
            padding: '0 4px',
            borderRadius: 3,
            background: '#fff',
            border: '1px solid var(--line)',
            color: m.color,
            fontSize: Math.max(6, Math.round(size * 0.42)),
            fontWeight: 800,
            fontStyle: 'italic',
            letterSpacing: '-.02em',
            lineHeight: 1,
          }}
        >
          {m.text}
        </span>
      ))}
    </span>
  );
}

/** The mark for a saved card row (brand chip, safe metadata only). */
