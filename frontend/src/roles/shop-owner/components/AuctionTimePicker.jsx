// frontend/src/roles/shop-owner/components/AuctionTimePicker.jsx
// Custom HOUR / MIN / AM-PM scroll picker — not <input type="time">.
import { useEffect, useRef } from 'react';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ['AM', 'PM'];

/** Wizard modal body is the only parent scroller we may need to keep stable. */
function getWizardScroller() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.modal-box.auction-wizard-modal .modal-box-body');
}

function TimeColumn({ items, value, onChange, format, ariaLabel }) {
  const listRef = useRef(null);
  const selectedRef = useRef(null);

  // Scroll ONLY this internal time column so the selected value is visible.
  // Do not touch the parent modal scroll position here.
  useEffect(() => {
    const list = listRef.current;
    const sel = selectedRef.current;
    if (!list || !sel) return;
    // .sched-time-list is position:relative — offsetTop is relative to the list.
    const next = sel.offsetTop - list.clientHeight / 2 + sel.clientHeight / 2;
    const max = Math.max(0, list.scrollHeight - list.clientHeight);
    const clamped = Math.min(Math.max(0, next), max);
    if (Math.abs(list.scrollTop - clamped) > 0.5) {
      list.scrollTop = clamped;
    }
  }, [value]);

  return (
    <div className="sched-time-col">
      <div className="sched-time-col-label">{ariaLabel}</div>
      <div className="sched-time-list" ref={listRef} role="listbox" aria-label={ariaLabel}>
        {items.map((item) => {
          const selected = item === value;
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={selected}
              ref={selected ? selectedRef : undefined}
              className={`sched-time-opt${selected ? ' is-selected' : ''}`}
              onMouseDown={(e) => {
                // Prevent click-focus from scrolling .modal-box-body to the button.
                // Keyboard users can still Tab to an option and press Enter/Space.
                e.preventDefault();
              }}
              onClick={() => onChange(item)}
            >
              {format ? format(item) : item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AuctionTimePicker({ label, hour, minute, period, onChange, disabled }) {
  const apply = (partial) => {
    // Snapshot the wizard modal body scroll, then restore it after the selection
    // commits. Only the internal time column may scroll — not the whole modal.
    const scroller = getWizardScroller();
    const prevTop = scroller ? scroller.scrollTop : 0;
    onChange({ hour, minute, period, ...partial });
    requestAnimationFrame(() => {
      const next = getWizardScroller();
      if (next) next.scrollTop = prevTop;
    });
  };
  return (
    <div className={`sched-time${disabled ? ' is-disabled' : ''}`}>
      <div className="sched-time-label">{label}</div>
      <div className="sched-time-cols">
        <TimeColumn
          items={HOURS}
          value={hour}
          onChange={(h) => apply({ hour: h })}
          ariaLabel="Hour"
        />
        <TimeColumn
          items={MINUTES}
          value={minute}
          onChange={(m) => apply({ minute: m })}
          format={(m) => String(m).padStart(2, '0')}
          ariaLabel="Minute"
        />
        <TimeColumn
          items={PERIODS}
          value={period}
          onChange={(p) => apply({ period: p })}
          ariaLabel="AM / PM"
        />
      </div>
    </div>
  );
}
