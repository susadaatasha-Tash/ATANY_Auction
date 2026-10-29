// frontend/src/roles/shop-owner/components/AuctionCalendar.jsx
// Custom month calendar for auction Schedule step — not a native date input.
import { useState, useEffect, useRef } from 'react';
import {
  WEEKDAYS,
  buildMonthMatrix,
  formatMonthLabel,
  fromDateKey,
  getLocalToday,
} from './auctionScheduleUtils';

export function AuctionCalendar({ value, onChange, minDateKey, ariaLabel }) {
  const todayKey = getLocalToday().dateKey;
  const init = value ? fromDateKey(value) : new Date();
  const [view, setView] = useState({
    year: init.getFullYear(),
    month: init.getMonth(),
  });
  // Today always produces visible behavior: month jump + select today +
  // focus, even when already on the current month (ping). Selection syncs
  // the bound form field through onChange (same path as clicking the day).
  const [todayPing, setTodayPing] = useState(0);
  // Transient helper when Today must snap to the earliest allowed date.
  const [snapNote, setSnapNote] = useState(null);
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

  const cells = buildMonthMatrix(view.year, view.month);
  const monthLabel = formatMonthLabel(view.year, view.month);

  const goPrev = () => {
    setSnapNote(null);
    setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  };
  const goNext = () => {
    setSnapNote(null);
    setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));
  };
  const goToday = () => {
    // Fresh Date objects (never mutate state in place) so React always
    // detects the change. Jump to the current local month, SELECT today
    // (gold tile moves here), focus its cell, and sync the bound field via
    // the same onChange path as clicking the day — local keys only.
    const t = getLocalToday();
    setView({ year: t.year, month: t.month });
    setSnapNote(null);
    if (!minDateKey || todayKey >= minDateKey) {
      onChange?.(todayKey);
    } else {
      // Today is before the earliest allowed date: snap visibly to the
      // minimum and explain (never silently do nothing). Downstream schedule
      // validation still surfaces any resulting inline errors.
      onChange?.(minDateKey);
      setSnapNote(`Today is before the earliest allowed date — snapped to ${minDateKey}.`);
    }
    setTodayPing((p) => p + 1);
  };

  // Ping lifecycle: emphasize + focus today's cell, then return to the
  // persistent marker. Runs on every Today press (month changed or not).
  // Depends on todayPing only — view changes from prev/next must NOT refocus.
  // (Both states update in one handler pass, so the effect runs after the new
  // month's cell has mounted and the ref is attached.)
  useEffect(() => {
    if (!todayPing) return;
    try { todayCellRef.current?.focus({ preventScroll: true }); } catch {}
    const t = setTimeout(() => setTodayPing(0), 1200);
    return () => clearTimeout(t);
  }, [todayPing]);

  return (
    <div className="sched-cal" role="group" aria-label={ariaLabel || 'Calendar'}>
      <div className="sched-cal-head">
        <span className="sched-cal-title">{monthLabel}</span>
        <div className="sched-cal-nav">
          <button type="button" className="sched-cal-today" onClick={goToday} aria-label="Go to today">Today</button>
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
              ref={isToday ? todayCellRef : undefined}
              className={`sched-cal-day${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${isToday && todayPing ? ' is-ping' : ''}`}
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => { setSnapNote(null); onChange(c.dateKey); }}
            >
              {c.day}
            </button>
          );
        })}
      </div>
      {snapNote && (
        <p className="sched-cal-note" role="status">{snapNote}</p>
      )}
    </div>
  );
}
