// frontend/src/roles/shop-owner/components/AuctionSchedulePreview.jsx
// Navy LOT SCHEDULE PREVIEW card — live values from draft (never hardcoded).
import {
  formatDayLabel,
  formatTimeFromLocal,
  parseLocal,
} from './auctionScheduleUtils';

export function AuctionSchedulePreview({ title, category, startLocal, endLocal, duration }) {
  const startOk = !!parseLocal(startLocal);
  const endOk = !!parseLocal(endLocal);
  return (
    <div className="sched-preview">
      <div className="sched-preview-head">LOT SCHEDULE PREVIEW</div>
      <div className="sched-preview-lot">
        <span className="sched-preview-lot-name">{title || 'Untitled lot'}</span>
        <span className="sched-preview-lot-cat">{category || '—'}</span>
      </div>
      <div className="sched-preview-cols">
        <div className="sched-preview-col">
          <span className="sched-preview-kicker">OPENS</span>
          <span className="sched-preview-date">{startOk ? formatDayLabel(parseLocal(startLocal).dateKey) : '—'}</span>
          <span className="sched-preview-time">{startOk ? formatTimeFromLocal(startLocal) : '—'}</span>
        </div>
        <div className="sched-preview-col">
          <span className="sched-preview-kicker">CLOSES</span>
          <span className="sched-preview-date">{endOk ? formatDayLabel(parseLocal(endLocal).dateKey) : '—'}</span>
          <span className="sched-preview-time">{endOk ? formatTimeFromLocal(endLocal) : '—'}</span>
        </div>
      </div>
      <div className="sched-preview-duration">
        {duration ? `Duration · ${duration}` : 'Duration · —'}
      </div>
    </div>
  );
}
