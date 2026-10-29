// frontend/src/roles/shop-owner/subscription/paymentBrands.jsx
// Local hand-authored brand marks — NO remote hotlinks, NO text-chip fakes.
// Every logo is an inline SVG React component rendered at a fixed box size so
// the payment-method rows keep identical rhythm regardless of mark shape.
import { CreditCard } from 'lucide-react';

const WORDMARK_FONT = "Arial, Helvetica, sans-serif";

function VisaMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="Visa">
      <rect width="48" height="32" rx="5" fill="#fff" stroke="#E5E7EB" />
      <text
        x="24"
        y="21.5"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="13"
        fontWeight="800"
        fontStyle="italic"
        letterSpacing="0.5"
        fill="#1A1F71"
      >
        VISA
      </text>
    </svg>
  );
}

function MastercardMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="Mastercard">
      <rect width="48" height="32" rx="5" fill="#fff" stroke="#E5E7EB" />
      <circle cx="19.5" cy="16" r="8.5" fill="#EB001B" />
      <circle cx="28.5" cy="16" r="8.5" fill="#F79E1B" />
      <path
        d="M24 9.6a8.48 8.48 0 0 0 0 12.8 8.48 8.48 0 0 0 0-12.8z"
        fill="#FF5F00"
      />
    </svg>
  );
}

function AmexMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="American Express">
      <rect width="48" height="32" rx="5" fill="#006FCF" />
      <text
        x="24"
        y="20.5"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="10"
        fontWeight="800"
        letterSpacing="0.6"
        fill="#fff"
      >
        AMEX
      </text>
    </svg>
  );
}

function JcbMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="JCB">
      <rect width="48" height="32" rx="5" fill="#fff" stroke="#E5E7EB" />
      <rect x="9" y="7" width="8.5" height="18" rx="3" fill="#0B4EA2" />
      <rect x="19.75" y="7" width="8.5" height="18" rx="3" fill="#C1122C" />
      <rect x="30.5" y="7" width="8.5" height="18" rx="3" fill="#00874E" />
      <text
        x="13.25"
        y="20"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="7"
        fontWeight="800"
        fill="#fff"
      >
        J
      </text>
      <text
        x="24"
        y="20"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="7"
        fontWeight="800"
        fill="#fff"
      >
        C
      </text>
      <text
        x="34.75"
        y="20"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="7"
        fontWeight="800"
        fill="#fff"
      >
        B
      </text>
    </svg>
  );
}

function QrPhMark() {
  return (
    <svg viewBox="0 0 40 40" role="img" aria-label="QR Ph">
      <rect width="40" height="40" rx="9" fill="#fff" stroke="#E5E7EB" />
      <rect x="7" y="7" width="11" height="11" rx="2.5" fill="none" stroke="#0F4C81" strokeWidth="3" />
      <rect x="11" y="11" width="3" height="3" fill="#0F4C81" />
      <rect x="22" y="7" width="11" height="11" rx="2.5" fill="none" stroke="#0F4C81" strokeWidth="3" />
      <rect x="26" y="11" width="3" height="3" fill="#0F4C81" />
      <rect x="7" y="22" width="11" height="11" rx="2.5" fill="none" stroke="#D64545" strokeWidth="3" />
      <rect x="11" y="26" width="3" height="3" fill="#D64545" />
      <rect x="22" y="22" width="3.5" height="3.5" fill="#0F4C81" />
      <rect x="28" y="22" width="3.5" height="3.5" fill="#D64545" />
      <rect x="22" y="28.5" width="3.5" height="3.5" fill="#D64545" />
      <rect x="28" y="28.5" width="3.5" height="3.5" fill="#0F4C81" />
    </svg>
  );
}

/** QR Ph brand wordmark shown on the right side of the QR Ph method row. */
export function QrPhWordmark() {
  return (
    <svg viewBox="0 0 68 24" role="img" aria-label="QR Ph" className="ssub-pm-wordmark">
      <rect x="1" y="4" width="7.5" height="7.5" rx="1.5" fill="none" stroke="#0F4C81" strokeWidth="2" />
      <rect x="3.4" y="6.4" width="2.7" height="2.7" fill="#0F4C81" />
      <rect x="10.5" y="4" width="7.5" height="7.5" rx="1.5" fill="none" stroke="#D64545" strokeWidth="2" />
      <rect x="12.9" y="6.4" width="2.7" height="2.7" fill="#D64545" />
      <rect x="1" y="13.5" width="7.5" height="7.5" rx="1.5" fill="none" stroke="#D64545" strokeWidth="2" />
      <rect x="3.4" y="15.9" width="2.7" height="2.7" fill="#D64545" />
      <rect x="11" y="14" width="3" height="3" fill="#0F4C81" />
      <rect x="15.5" y="18.5" width="3" height="3" fill="#0F4C81" />
      <text x="23" y="19.5" fontFamily={WORDMARK_FONT} fontSize="16" fontWeight="800" fill="#0F4C81">QR</text>
      <text x="45.5" y="19.5" fontFamily={WORDMARK_FONT} fontSize="16" fontWeight="800" fill="#D64545">Ph</text>
    </svg>
  );
}

function GcashMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="GCash">
      <rect width="48" height="32" rx="5" fill="#0072CE" />
      <text
        x="24"
        y="21.5"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="14"
        fontWeight="800"
        fill="#fff"
      >
        G
      </text>
      <path
        d="M28.5 12.5h-4.2a4.3 4.3 0 1 0 0 8.6h4.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MayaMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="Maya">
      <rect width="48" height="32" rx="5" fill="#111111" />
      <text
        x="24"
        y="21"
        textAnchor="middle"
        fontFamily={WORDMARK_FONT}
        fontSize="12.5"
        fontWeight="800"
        fill="#ffffff"
      >
        maya
      </text>
    </svg>
  );
}

function CardMark() {
  return (
    <svg viewBox="0 0 48 32" role="img" aria-label="Card">
      <rect width="48" height="32" rx="5" fill="#F3F4F6" stroke="#E5E7EB" />
      <g transform="translate(12,7)" color="#142A4A">
        <CreditCard width="24" height="18" strokeWidth={1.8} />
      </g>
    </svg>
  );
}

const MARKS = {
  visa: VisaMark,
  mastercard: MastercardMark,
  amex: AmexMark,
  jcb: JcbMark,
  discover: CardMark,
  diners: CardMark,
  card: CardMark,
  qrph: QrPhMark,
  gcash: GcashMark,
  maya: MayaMark,
};

export const BRAND_LABELS = {
  visa: 'VISA',
  mastercard: 'MC',
  amex: 'AMEX',
  jcb: 'JCB',
  discover: 'DISC',
  diners: 'DINERS',
};

export function brandLabel(brand) {
  const key = String(brand || 'card').toLowerCase();
  return BRAND_LABELS[key] || String(brand || 'card').toUpperCase().slice(0, 6);
}

export function brandChipClass(brand) {
  const key = String(brand || 'card').toLowerCase();
  return BRAND_LABELS[key] ? `ssub-pm-brand ssub-pm-brand--${key}` : 'ssub-pm-brand';
}

/**
 * Fixed-size logo box for payment rows.
 * `id`: brand (visa/mastercard/...) or method (qrph/gcash/maya/card).
 */
export function PaymentBrandLogo({ id, size = 'md', className = '' }) {
  const key = String(id || 'card').toLowerCase();
  const Mark = MARKS[key] || CardMark;
  return (
    <span className={`ssub-pm-logo ssub-pm-logo--${size} ${className}`.trim()} data-testid={`logo-${key}`}>
      <Mark />
    </span>
  );
}
