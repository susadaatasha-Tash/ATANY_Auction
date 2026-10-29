// frontend/src/roles/shop-owner/components/SellerAuctionCalendar.jsx
// Seller overview calendar: monthly scheduled-lot markers + upcoming timeline.
// Read-only visualization over the SAME manage-endpoint dataset as List mode.
// - Local-timezone date keys (toDateKey), never UTC slicing.
// - Only stored `scheduled` auctions mark dates/timeline (live/paused/ended excluded).
// - Backend remains authoritative for all lifecycle transitions (starter/closer).
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WEEKDAYS,
  buildMonthMatrix,
  formatMonthLabel,
  pad2,
  toDateKey,
} from './auctionScheduleUtils';

function peso(n) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(Number(n || 0));
}

export function getLocalDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toDateKey(d);
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export default function SellerAuctionCalendar({ auctions = [], onSelectAuction }) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(null);

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const scheduledAuctions = useMemo(
    () => (auctions || []).filter((a) => String(a?.status || '').toLowerCase() === 'scheduled'),
    [auctions]
  );

  const scheduledByDate = useMemo(() => {
    const map = {};
    for (const a of scheduledAuctions) {
      const key = getLocalDateKey(a.start_time);
      if (!key) continue;
      (map[key] = map[key] || []).push(a);
    }
    return map;
  }, [scheduledAuctions]);

  const visibleScheduled = useMemo(() => {
    const prefix = `${visibleMonth.getFullYear()}-${pad2(visibleMonth.getMonth() + 1)}`;
    return scheduledAuctions.filter((a) => (getLocalDateKey(a.start_time) || '').startsWith(prefix));
  }, [scheduledAuctions, visibleMonth]);

  const upcoming = useMemo(() => {
    const nowMs = Date.now();
    let list = scheduledAuctions.filter((a) => {
      const t = new Date(a.start_time).getTime();
      return !Number.isNaN(t) && t >= nowMs;
    });
    if (selectedDate) list = list.filter((a) => getLocalDateKey(a.start_time) === selectedDate);
    return list.slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  }, [scheduledAuctions, selectedDate]);

  const cells = useMemo(
    () => buildMonthMatrix(visibleMonth.getFullYear(), visibleMonth.getMonth()),
    [visibleMonth]
  );

  const goMonth = (delta) => {
    setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
    setSelectedDate(null);
  };
  // Every Today press pings + focuses today's cell (observable even when
  // already on the current month). Timeline selection clears per existing UX.
  const [todayPing, setTodayPing] = useState(0);
  const todayCellRef = useRef(null);
  const goToday = () => {
    setVisibleMonth(startOfMonth(new Date()));
    setSelectedDate(null);
    setTodayPing((p) => p + 1);
  };
  useEffect(() => {
    if (!todayPing) return;
    try { todayCellRef.current?.focus({ preventScroll: true }); } catch {}
    const t = setTimeout(() => setTodayPing(0), 1200);
    return () => clearTimeout(t);
  }, [todayPing]);
  const toggleDate = (key) => {
    if (!key) return;
    setSelectedDate((cur) => (cur === key ? null : key));
  };

  return (
    <div>
      <div className="mauc-cal-grid">
        <section className="mauc-cal-panel" aria-label="Scheduled lots calendar">
          <div className="mauc-cal__head">
            <div>
              <h3 className="mauc-cal__title">{formatMonthLabel(visibleMonth.getFullYear(), visibleMonth.getMonth())}</h3>
              <div className="mauc-cal__sub">{visibleScheduled.length} scheduled lots</div>
            </div>
            <div className="mauc-cal__nav">
              <button type="button" className="mauc-btn" onClick={goToday} aria-label="Go to current month">Today</button>
              <button type="button" className="mauc-btn mauc-btn--icon" onClick={() => goMonth(-1)} aria-label="Previous month">‹</button>
              <button type="button" className="mauc-btn mauc-btn--icon" onClick={() => goMonth(1)} aria-label="Next month">›</button>
            </div>
          </div>
          <div className="mauc-cal__week" aria-hidden="true">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="mauc-cal__matrix">
            {cells.map((cell, i) => {
              if (!cell.inMonth) return <span key={i} className="mauc-cal__cell mauc-cal__cell--blank" />;
              const count = (scheduledByDate[cell.dateKey] || []).length;
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDate;
              const label = new Date(cell.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
              return (
                <button
                  key={i}
                  type="button"
                  ref={isToday ? todayCellRef : undefined}
                  className={`mauc-cal__cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${count ? ' has-lots' : ''}${isToday && todayPing ? ' is-ping' : ''}`}
                  onClick={() => toggleDate(cell.dateKey)}
                  aria-label={`${label}, ${count ? `${count} scheduled auction${count === 1 ? '' : 's'}` : 'no scheduled auctions'}`}
                  aria-pressed={isSelected}
                >
                  <span className="mauc-cal__day">{cell.day}</span>
                  {count > 0 && (
                    <span className="mauc-cal__badge" aria-hidden="true">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" /><path d="m16 16 6-6" /><path d="m8 8 6-6" /><path d="m9 7 8 8" /><path d="m21 11-8-8" /></svg>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mauc-cal__legend">
            <span><i className="mauc-cal__legend--sched" aria-hidden="true" /> Scheduled lot</span>
            <span><i className="mauc-cal__legend--today" aria-hidden="true" /> Today</span>
          </div>
        </section>

        <section className="mauc-cal-panel" aria-label="Upcoming timeline">
          <h3 className="mauc-cal__title">Upcoming timeline</h3>
          <div className="mauc-cal__sub">
            {selectedDate ? `Scheduled for ${new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'All scheduled lots by open time'}
            {selectedDate && (
              <button type="button" className="mauc-cal__clear" onClick={() => setSelectedDate(null)}>Clear date</button>
            )}
          </div>
          {upcoming.length === 0 ? (
            <div className="mauc-cal__empty">
              <p><strong>No upcoming auctions</strong></p>
              <p>Scheduled auctions will appear here once you create them.</p>
            </div>
          ) : (
            <ul className="mauc-cal__timeline">
              {upcoming.map((a) => {
                const start = new Date(a.start_time);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="mauc-cal__item"
                      onClick={() => onSelectAuction?.(a)}
                      aria-label={`View ${a.title || 'auction'}, opens ${start.toLocaleString()}`}
                    >
                      <span className="mauc-cal__tile" aria-hidden="true">
                        <b>{start.getDate()}</b>
                        <span>{MONTH_SHORT[start.getMonth()]}</span>
                      </span>
                      <span className="mauc-cal__itemmain">
                        <span className="mauc-cal__itemtop">
                          <span className="mauc-cal__lot">{a.lot_code || a.auction_code || `LOT-${String(a.id).slice(0, 4).toUpperCase()}`}</span>
                          <span className="mauc-cal__time">🕐 {formatTime(a.start_time)}</span>
                        </span>
                        <span className="mauc-cal__name">{a.title || a.name || 'Untitled lot'}</span>
                        <span className="mauc-cal__meta">{a.category || 'Other'} · {a.branch || a.branch_name || 'Branch'}</span>
                      </span>
                      <span className="mauc-cal__price">
                        <span className="mauc-cal__pricelabel">Starts at</span>
                        <b>{peso(a.start_price ?? a.startPrice)}</b>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      <div className="mauc-cal__note" role="note">
        <span aria-hidden="true">ⓘ</span> Each lot opens on its scheduled date and time. Winners pick up in-branch — no delivery.
      </div>
    </div>
  );
}
