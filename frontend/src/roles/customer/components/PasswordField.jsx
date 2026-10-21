// frontend/src/roles/customer/components/PasswordField.jsx
// Reusable password input with an ATANY show/hide eye toggle.
//
// The toggle sits INSIDE the field on the right and the input reserves the
// matching right padding so the text never runs under the icon. We do NOT try
// to suppress browser-injected password-manager/autofill controls — the eye
// button is the application's own visibility control and sits in its own
// reserved gutter, clear of the browser's UI.
import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  placeholder = '••••••••',
  error,
  disabled,
  id,
  name,
  resetToken,
}) {
  const [visible, setVisible] = useState(false);
  const fieldId = id || `pwd-${name}`;
  const showLabel = `Show ${label.toLowerCase()}`;
  const hideLabel = `Hide ${label.toLowerCase()}`;

  // Reset the visibility back to hidden (e.g. after a successful password
  // change clears the field) without remounting the component.
  useEffect(() => {
    if (resetToken !== undefined) setVisible(false);
  }, [resetToken]);

  return (
    <div className="form-row">
      <label htmlFor={fieldId}>{label}</label>
      <div className="pwd-field">
        <input
          id={fieldId}
          name={name}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
        <button
          type="button"
          className="pwd-field__toggle"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          title={visible ? hideLabel : showLabel}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
      {error && <p className="wizard-field-error" id={`${fieldId}-error`}>{error}</p>}
    </div>
  );
}

export default PasswordField;
