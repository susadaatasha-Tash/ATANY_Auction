// frontend/src/roles/shop-owner/components/WizardStepper.jsx
// Shared 4-step progress indicator for the auction wizard (Create + Relist).
// Horizontal connector lines run between the step circles so the progress reads
// as one connected flow. ATANY visual language only: navy labels, gold current
// step, green completed step, warm neutral borders.
export function WizardStepper({ steps, current, onJump, disabled = false }) {
  return (
    <ol className="wizard-steps" aria-label="Auction wizard steps">
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={s.key} className={`wizard-step ${state}`}>
            <button
              type="button"
              className="wizard-step-btn"
              onClick={() => i < current && onJump?.(i)}
              disabled={i > current || disabled}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="wizard-step-num" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
              <span className="wizard-step-name">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default WizardStepper;
