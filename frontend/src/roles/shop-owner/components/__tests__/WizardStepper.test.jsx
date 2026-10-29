import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { CreateAuctionWizard } from '../CreateAuctionWizard';

vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: vi.fn() }));

beforeEach(() => window.localStorage.clear());

function openWizard() {
  render(<CreateAuctionWizard open onClose={() => {}} onSubmit={async () => true} />);
}

function fillStep1() {
  fireEvent.change(screen.getByPlaceholderText(/Antique Filigree/i), { target: { value: 'Test Ring' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

test('four steps render with connector lines between them', () => {
  openWizard();
  expect(screen.getByText('Lot Details')).toBeInTheDocument();
  expect(screen.getByText('Schedule')).toBeInTheDocument();
  expect(screen.getByText('Bidding Rules')).toBeInTheDocument();
  expect(screen.getByText('Review')).toBeInTheDocument();
  const connectors = document.querySelectorAll('.step-connector');
  expect(connectors.length).toBe(3);
});

test('current step is gold, completed shows check, upcoming muted', () => {
  openWizard();
  const steps = document.querySelectorAll('.wizard-step');
  expect(steps[0].className).toMatch(/active/);
  expect(steps[1].className).toMatch(/todo/);
  fillStep1();
  const steps2 = document.querySelectorAll('.wizard-step');
  expect(steps2[0].className).toMatch(/done/);
  expect(steps2[0].textContent).toMatch(/✓/);
  expect(steps2[1].className).toMatch(/active/);
  expect(document.querySelector('.step-connector.is-done')).not.toBeNull();
});

test('Continue moves forward, Back moves backward, aria-current updates', () => {
  openWizard();
  expect(screen.getByRole('button', { name: /Lot Details/ })).toHaveAttribute('aria-current', 'step');
  fillStep1();
  expect(screen.getByRole('button', { name: /Schedule/ })).toHaveAttribute('aria-current', 'step');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('button', { name: /Lot Details/ })).toHaveAttribute('aria-current', 'step');
});

test('wizard header uses ATANY eyebrow + title', () => {
  openWizard();
  expect(screen.getByText('New auction')).toBeInTheDocument();
  expect(screen.getByText('Create an auction lot')).toBeInTheDocument();
});
