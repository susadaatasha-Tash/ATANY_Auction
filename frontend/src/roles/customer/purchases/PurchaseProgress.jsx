// frontend/src/roles/customer/purchases/PurchaseProgress.jsx
import { getPurchaseProgress } from '../lib/purchaseStatus';
import { formatShortDate } from '../lib/paymentDeadline';

export function PurchaseProgress({ order }) {
  const progress = getPurchaseProgress(order);
  const wonDate = order?.winner_confirmed_at || order?.date || order?.created_at;

  return (
    <div className="mp-progress">
      <div className="mp-progress-head">
        <span className="mp-progress-title">Order progress</span>
        <span className="mp-progress-text">{progress.text}</span>
      </div>
      <ol className="mp-progress-track" aria-label="Order progress">
        {progress.stages.map((stage, i) => {
          const isDone = stage.done;
          const isCurrent = i === progress.currentIndex && !stage.done;
          const stateCls = isDone ? 'is-done' : isCurrent ? 'is-current' : 'is-todo';
          return (
            <li key={stage.key} className={`mp-progress-step ${stateCls}`}>
              <div className="mp-progress-rail" aria-hidden="true">
                <span className="mp-progress-dot" />
                {i < progress.stages.length - 1 && <span className={`mp-progress-line${progress.stages[i + 1].done || isDone ? ' is-fill' : ''}`} />}
              </div>
              <div className="mp-progress-label">{stage.label}</div>
              {stage.key === 'won' && wonDate && (
                <div className="mp-progress-sub">{formatShortDate(wonDate)}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
