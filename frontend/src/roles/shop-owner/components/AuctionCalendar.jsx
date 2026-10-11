// frontend/src/roles/shop-owner/components/AuctionCalendar.jsx
// Custom month calendar for auction Schedule step — not a native date input.
import { useState, useEffect } from 'react';
import {
  WEEKDAYS,
  buildMonthMatrix,
  formatMonthLabel,
  fromDateKey,
  toDateKey,
} from './auctionScheduleUtils';

export function AuctionCalendar({ value, onChange, minDateKey, ariaLabel }) {
  const todayKey = toDateKey(new Date());
  const init = value ? fromDateKey(value) : new Date();
  const [view, setView] = useState({
    year: init.getFullYear(),
    month: init.getMonth(),
  });

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

  const cells = buildMonthMatrix(view.year, view.month);
  const monthLabel = formatMonthLabel(view.year, view.month);

  const goPrev = () => {
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };
  const goNext = () => {
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };
  const goToday = () => {
    const n = new Date();
    setView({ year: n.getFullYear(), month: n.getMonth() });
  };

  return (
    <div className="sched-cal" role="group" aria-label={ariaLabel || 'Calendar'}>
      <div className="sched-cal-head">
        <span className="sched-cal-title">{monthLabel}</span>
        <div className="sched-cal-nav">
          <button type="button" className="sched-cal-today" onClick={goToday}>Today</button>
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
          return (
            <button
              key={c.dateKey}
              type="button"
              className={`sched-cal-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(c.dateKey)}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
