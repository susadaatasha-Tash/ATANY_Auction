// frontend/src/shared/ui/Skeleton.jsx
// ONE ATANY skeleton system shared by every portal (customer, seller, admin).
// Replaces the four duplicate shimmer implementations that previously existed
// (mp-skeleton / sdash-skeleton / mauc-skeleton / sub-skel).
//
// Design rules enforced here:
// - Purely decorative: never focusable, always aria-hidden, driven by the REAL
//   request state (no timers, no artificial delays).
// - No fake content: blocks only, never numbers, prices or labels.
// - Animation is a single subtle shimmer that is disabled under
//   prefers-reduced-motion (see skeleton.css).
// - Dimensions are supplied by the caller so each portal can mirror its own
//   real components instead of a one-size-fits-all dashboard block.
import './skeleton.css';

/**
 * Base skeleton block.
 * `w`/`h` accept CSS lengths ("40%", 14, "120px"); omit `h` for auto height.
 */
export function Skeleton({ className = '', w, h, r, style, ...rest }) {
  return (
    <span
      className={`atany-skel ${className}`.trim()}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden="true"
      {...rest}
    />
  );
}

/** Circular block — icon slots, avatars, status dots. */
export function SkeletonCircle({ size = 18, className = '', style }) {
  return <Skeleton className={className} w={size} h={size} r="50%" style={style} />;
}

/**
 * Stacked text lines. `last` shrinks the final line the way real paragraphs end.
 */
export function SkeletonText({ lines = 1, w = '100%', h = 12, gap = 6, last = 0.62, className = '' }) {
  return (
    <span className={`atany-skel-text ${className}`.trim()} style={{ gap }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            w={i === lines - 1 && lines > 1 ? `${Math.round(last * 100)}%` : w}
            h={h}
          />
        ))}
      </span>
  );
}

/**
 * Mirrors a `.kpi-card` (icon + label / divider / big value / badge) so the
 * KPI grid keeps identical geometry before and after data arrives.
 */
export function SkeletonKpiCard({ badge = true, className = '' }) {
  return (
    <div className={`atany-skel-kpi ${className}`.trim()} aria-hidden="true">
      <div className="atany-skel-kpi__head">
        <SkeletonCircle size={18} />
        <Skeleton w="52%" h={11} />
      </div>
      <Skeleton className="atany-skel-kpi__divider" w="100%" h={1} />
      <Skeleton w="46%" h={26} />
      {badge && <Skeleton w="38%" h={20} r="999px" className="atany-skel-kpi__badge" />}
    </div>
  );
}

/** N KPI skeletons for a `.kpi-grid` (4 columns on desktop, same breakpoints). */
export function SkeletonKpiRow({ count = 4, className = '' }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonKpiCard key={i} />
      ))}
    </>
  );
}

/**
 * Table row skeleton used inside a real `.table-wrap`/table structure so column
 * widths match the loaded table (prevents the classic skeleton→table shift).
 */
export function SkeletonTable({ rows = 5, cols = 6, colFlex, className = '' }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className={`atany-skel-tr ${className}`.trim()} aria-hidden="true">
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j}>
              <Skeleton w={colFlex?.[j] || '100%'} h={14} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * Generic list skeleton (activity feeds, branch cards, order rows).
 * `render` shapes one item; defaults to a two-column text line.
 */
export function SkeletonList({ count = 4, render, className = '' }) {
  return (
    <div className={`atany-skel-list ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) =>
        render ? (
          <div key={i} className="atany-skel-list__item">
            {render(i)}
          </div>
        ) : (
          <div key={i} className="atany-skel-list__item">
            <SkeletonCircle size={28} />
            <SkeletonText lines={2} w="80%" />
          </div>
        )
      )}
    </div>
  );
}

/**
 * Wraps a skeleton region and marks it busy for assistive tech without making
 * any skeleton block focusable.
 */
export function SkeletonRegion({ label, className = '', children }) {
  return (
    <div className={`atany-skel-region ${className}`.trim()} aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

export default Skeleton;