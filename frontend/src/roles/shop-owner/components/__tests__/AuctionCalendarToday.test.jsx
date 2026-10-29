import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { AuctionCalendar } from '../AuctionCalendar';
import { toDateKey, getLocalToday } from '../auctionScheduleUtils';

function otherMonthKey() {
  const t = getLocalToday();
  const d = new Date(t.year, t.month + 1, 12);
  return toDateKey(d);
}
function curLabel() {
  const n = new Date();
  return n.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
const TODAY = getLocalToday().dateKey;

test('1. different month -> Today opens current month AND selects today', () => {
  const onChange = vi.fn();
  const { container } = render(<AuctionCalendar value={otherMonthKey()} onChange={onChange} />);
  expect(screen.queryByText(curLabel())).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  expect(screen.getByText(curLabel())).toBeInTheDocument();
  // Bound form value synced through the same onChange path as clicking the day
  expect(onChange).toHaveBeenCalledWith(TODAY);
  const todayBtn = container.querySelector('.sched-cal-day.is-today');
  expect(todayBtn).not.toBeNull();
  expect(todayBtn.textContent).toBe(String(getLocalToday().day));
});

test('2. same month, other date selected -> gold tile moves to today', () => {
  const onChange = vi.fn();
  render(<AuctionCalendar value={otherMonthKey()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  // Bound value syncs to today through onChange (parent applies it next)
  expect(onChange).toHaveBeenCalledWith(TODAY);
});

test('2b. selected gold tile renders on today after value syncs', () => {
  const onChange = vi.fn();
  const { container, rerender } = render(<AuctionCalendar value={otherMonthKey()} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  rerender(<AuctionCalendar value={TODAY} onChange={onChange} />);
  const sel = container.querySelector('.sched-cal-day.is-selected');
  expect(sel).not.toBeNull();
  expect(sel.classList.contains('is-today')).toBe(true);
  expect(sel.textContent).toBe(String(getLocalToday().day));
});

test('4. focus moves to today cell (keyboard observable)', () => {
  const onChange = vi.fn();
  const { container } = render(<AuctionCalendar value={toDateKey(new Date())} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  const pinged = container.querySelector('.sched-cal-day.is-ping');
  expect(pinged).not.toBeNull();
  expect(document.activeElement).toBe(pinged);
});

test('B2. ping clears back to the persistent marker', async () => {
  const onChange = vi.fn();
  const { container } = render(<AuctionCalendar value={toDateKey(new Date())} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  expect(container.querySelector('.sched-cal-day.is-ping')).not.toBeNull();
  await new Promise((r) => setTimeout(r, 1350));
  expect(container.querySelector('.sched-cal-day.is-ping')).toBeNull();
  expect(container.querySelector('.sched-cal-day.is-today')).not.toBeNull();
});

test('minDate restriction snaps visibly with helper (never silent)', () => {
  const onChange = vi.fn();
  // Earliest allowed date is in the future: today itself is disallowed
  const t = getLocalToday();
  const future = toDateKey(new Date(t.year, t.month, t.day + 5));
  const { container } = render(
    <AuctionCalendar value={future} minDateKey={future} onChange={onChange} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Go to today' }));
  expect(onChange).toHaveBeenCalledWith(future);
  expect(onChange).not.toHaveBeenCalledWith(TODAY);
  expect(screen.getByText(/snapped to/)).toBeInTheDocument();
  void container;
});

test('5/E. local date handling never shifts across UTC boundary', () => {
  // 23:30 local must stay on the local date even where UTC is already tomorrow
  expect(toDateKey(new Date(2026, 9, 11, 23, 30))).toBe('2026-10-11');
  expect(toDateKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  expect(getLocalToday().dateKey).toBe(toDateKey(new Date()));
});
