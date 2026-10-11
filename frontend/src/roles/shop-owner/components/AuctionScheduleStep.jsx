// frontend/src/roles/shop-owner/components/AuctionScheduleStep.jsx
// Step 2 — Schedule: custom calendar + time pickers + navy preview.
// Writes existing draft fields start/end ('YYYY-MM-DDTHH:mm') via parent patch().
// Publish still converts these to UTC ISO; backend remains source of truth.
import { AuctionCalendar } from './AuctionCalendar';
import { AuctionTimePicker } from './AuctionTimePicker';
import { AuctionSchedulePreview } from './AuctionSchedulePreview';
import {
  addDaysToKey,
  composeLocal,
  durationText,
  ensureEndAfterStart,
  parseLocal,
  scheduleValidation,
  toDateKey,
} from './auctionScheduleUtils';

export function AuctionScheduleStep({ draft, patch, errors }) {
  const todayKey = toDateKey(new Date());
  const startParts = parseLocal(draft.start);
  const endParts = parseLocal(draft.end);

  const startDateKey = startParts?.dateKey || todayKey;
  const startHour = startParts?.hour12 ?? 10;
  const startMinute = startParts?.minute ?? 0;
  const startPeriod = startParts?.period ?? 'AM';

  const endDateKey = endParts?.dateKey || startDateKey;
  const endHour = endParts?.hour12 ?? 10;
  const endMinute = endParts?.minute ?? 0;
  const endPeriod = endParts?.period ?? 'AM';

  const validation = scheduleValidation(draft.start, draft.end);
  const duration = durationText(draft.start, draft.end);
  const liveError = validation?.message || errors?.schedule || null;

  const applyStart = (dateKey, hour12, minute, period) => {
    const nextStart = composeLocal(dateKey, hour12, minute, period);
    const nextEnd = ensureEndAfterStart(nextStart, draft.end);
    patch({ start: nextStart, end: nextEnd });
  };

  const applyEnd = (dateKey, hour12, minute, period) => {
    patch({ end: composeLocal(dateKey, hour12, minute, period) });
  };

  const quickTonight = () => {
    applyStart(todayKey, 7, 0, 'PM');
  };

  const quickTomorrow = () => {
    applyStart(addDaysToKey(todayKey, 1), 10, 0, 'AM');
  };

  return (
    <div className="wizard-panel sched-step">
      <div className="sched-section">
        <div className="sched-section-head">
          <h4 className="sched-section-title">Auction start date</h4>
          <div className="sched-quick">
            <button type="button" className="sched-quick-btn" onClick={quickTonight}>
              Tonight 7:00 PM
            </button>
            <button type="button" className="sched-quick-btn" onClick={quickTomorrow}>
              Tomorrow 10:00 AM
            </button>
          </div>
        </div>
        <AuctionCalendar
          value={startDateKey}
          minDateKey={todayKey}
          ariaLabel="Auction start date"
          onChange={(dateKey) => applyStart(dateKey, startHour, startMinute, startPeriod)}
        />
      </div>

      <AuctionTimePicker
        label="Start time"
        hour={startHour}
        minute={startMinute}
        period={startPeriod}
        onChange={({ hour, minute, period }) => applyStart(startDateKey, hour, minute, period)}
      />

      <div className="sched-section">
        <div className="sched-section-head">
          <h4 className="sched-section-title">Auction end date</h4>
          <span className="form-hint">Same day or a later date</span>
        </div>
        <AuctionCalendar
          value={endDateKey}
          minDateKey={startDateKey}
          ariaLabel="Auction end date"
          onChange={(dateKey) => applyEnd(dateKey, endHour, endMinute, endPeriod)}
        />
      </div>

      <AuctionTimePicker
        label="End time"
        hour={endHour}
        minute={endMinute}
        period={endPeriod}
        onChange={({ hour, minute, period }) => applyEnd(endDateKey, hour, minute, period)}
      />

      <div className="sched-duration-row">
        <span className="sched-duration-label">Duration</span>
        <span className={`sched-duration-pill${validation && validation.field === 'end' ? ' is-error' : ''}`}>
          {duration ? duration : validation ? '—' : '—'}
        </span>
      </div>

      {liveError && <p className="wizard-field-error sched-validation">{liveError}</p>}

      <AuctionSchedulePreview
        title={draft.name}
        category={draft.category}
        startLocal={draft.start}
        endLocal={draft.end}
        duration={duration}
      />

      <p className="form-hint">
        Start and end use this device’s local time. Overnight auctions are fine — end must simply be after start.
        Nothing is saved to the server until Publish lot on the final step.
      </p>
    </div>
  );
}
