// frontend/src/roles/shop-owner/components/AuctionCalendar.jsx
// Custom month calendar for auction Schedule step — not a native date input.
// The Today button jumps to the current local month AND selects today's date.
import { useState, useEffect, useRef } from 'react';
import {
  WEEKDAYS,
  buildMonthMatrix,
  formatMonthLabel,
  fromDateKey,
  toDateKey,
  formatDayLabel,
} from './auctionScheduleUtils';

export function AuctionCalendar({ value, onChange, minDateKey, ariaLabel, onToday }) {
  const todayKey = toDateKey(new Date());
  const init = value ? fromDateKey(value) : new Date();
  const [view, setView] = useState({
    year: init.getFullYear(),
    month: init.getMonth(),
  });
  // Tracks which date cell should receive keyboard focus after a render
  // (e.g. after clicking Today).
  const [focusedDate, setFocusedDate] = useState(null);
  const todayCellRef = useRef(null);

  // Keep the visible month in sync when the selected date changes externally.
  useEffect(() => {
    if (!value) return;
    const d = fromDateKey(value);
    setView((v) =>
      v.year === d.getFullYear() && v.month === d.getMonth()
        ? v
        : { year: d.getFullYear(), month: d.getMonth() }
    );
  }, [value]);

  // Move keyboard focus to the tracked date cell after it renders.
  useEffect(() => {
    if (focusedDate && todayCellRef.current) {
      todayCellRef.current.focus();
    }
  }, [focusedDate]);

  const cells = buildMonthMatrix(view.year, view.month);
  const monthLabel = formatMonthLabel(view.year, view.month);

  const goPrev = () => {
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };
  const goNext = () => {
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };

  // Today: jump to the current local month AND select today's date.
  // If today is disabled by minDateKey (e.g. end date before start date),
  // navigate + focus but do not change the selection; the parent is notified
  // via onToday so it can show an inline validation message.
  const goToday = () => {
    const n = new Date();
    const tk = toDateKey(n);
    const todayDisabled = !!minDateKey && tk < minDateKey;
    setView({ year: n.getFullYear(), month: n.getMonth() });
    setFocusedDate(tk);
    if (todayDisabled) {
      if (onToday) onToday(tk, true);
      return;
    }
    if (onToday) onToday(tk, false);
    onChange(tk);
  };

  return (
    <div className="sched-cal" role="group" aria-label={ariaLabel || 'Calendar'}>
      <div className="sched-cal-head">
        <span className="sched-cal-title">{monthLabel}</span>
        <div className="sched-cal-nav">
          <button
            type="button"
            className="sched-cal-today"
            onClick={goToday}
            aria-label="Go to today"
          >
            Today
          </button>
          <button type="button" className="sched-cal-arrow" onClick={goPrev} aria-label="Previous month">‹</button>
          <button type="button" className="sched-cal-arrow" onClick={goNext} aria-label="Next month">›</button>
        </div>
      </div>
      <div className="sched-cal-dow" aria-hidden="true">
        {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="sched-cal-grid">
        {cells.map((c, i) => {
          if (!c.inMonth || !c.dateKey) {
            return <span key={`pad-${i}`} className="sched-cal-day is-pad" />;
          }
          const disabled = !!minDateKey && c.dateKey < minDateKey;
          const selected = value === c.dateKey;
          const isToday = c.dateKey === todayKey;
          const isFocused = focusedDate === c.dateKey;
          return (
            <button
              key={c.dateKey}
              type="button"
              ref={isToday ? todayCellRef : undefined}
              className={`sched-cal-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isFocused ? ' is-focused' : ''}`}
              disabled={disabled}
              aria-pressed={selected}
              aria-label={isToday ? `Today, ${formatDayLabel(c.dateKey)}` : undefined}
              onClick={() => {
                onChange(c.dateKey);
                setFocusedDate(c.dateKey);
              }}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
