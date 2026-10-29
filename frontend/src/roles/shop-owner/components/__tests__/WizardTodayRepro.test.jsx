import { render, screen, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { CreateAuctionWizard } from '../CreateAuctionWizard';

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));

function curLabel() {
  const n = new Date();
  return n.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

test('wizard schedule: Today returns from another month', async () => {
  window.localStorage.clear();
  render(<CreateAuctionWizard open onClose={() => {}} onSubmit={async () => true} />);
  fireEvent.change(screen.getByPlaceholderText(/Antique Filigree/i), { target: { value: 'Test Ring' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  // Now on Schedule step — navigate the START calendar away, then Today it back
  const startCal = await screen.findByRole('group', { name: 'Auction start date' });
  const startScope = within(startCal);
  fireEvent.click(startScope.getByRole('button', { name: 'Next month' }));
  expect(within(startCal).queryByText(curLabel())).toBeNull();
  fireEvent.click(startScope.getByRole('button', { name: 'Go to today' }));
  // Month back + today selected (gold tile) + bound start synced to today
  expect(within(startCal).getByText(curLabel())).toBeInTheDocument();
  const sel = startCal.querySelector('.sched-cal-day.is-selected');
  expect(sel).not.toBeNull();
  expect(sel.classList.contains('is-today')).toBe(true);
  expect(sel.textContent).toBe(String(new Date().getDate()));
  // Feedback occurred
  expect(startCal.querySelector('.sched-cal-day.is-ping')).not.toBeNull();
});
