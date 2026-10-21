// frontend/src/roles/shop-owner/components/__tests__/AuctionWizard.test.jsx
// The shared auction wizard in RELIST mode: 4 steps, prefilled source data,
// step validation, review summary and the relist payload.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssSrc = fs.readFileSync(path.join(__dirname, '../../../../index.css'), 'utf8');

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import { AuctionWizard } from '../AuctionWizard';

const SOURCE = {
  id: 'auc-1',
  title: 'Rose Gold Bangle',
  name: 'Rose Gold Bangle',
  category: 'Bracelets',
  karat_weight: '18K',
  description: 'Real product description',
  image_url: 'bangle.jpg',
  branch: 'Gmall Branch',
  branch_name: 'Gmall Branch',
  lot_code: 'A-812',
  auction_code: 'A-812',
  start_price: 50000,
  minimum_bid_increment: 2500,
  status: 'ended',
};

function renderWizard(overrides = {}) {
  const onSubmit = overrides.onSubmit || vi.fn(async () => ({ id: 'new-auc' }));
  const utils = render(
    <AuctionWizard
      mode="relist"
      open
      sourceAuction={SOURCE}
      onClose={overrides.onClose || vi.fn()}
      onSubmit={onSubmit}
    />
  );
  return { ...utils, onSubmit };
}

const clickContinue = () => fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
const clickBack = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));

describe('AuctionWizard — relist mode', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
    localStorage.clear();
  });

  it('19. opens the same four-step wizard as Create Auction', () => {
    renderWizard();
    expect(screen.getByText('Relist Auction — Rose Gold Bangle')).toBeInTheDocument();
    ['Lot Details', 'Schedule', 'Bidding Rules', 'Review'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    expect(screen.getByText('Step 1 of 4 · Lot Details')).toBeInTheDocument();
  });

  it('20. prefills the real lot data from the source auction', () => {
    renderWizard();
    expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument();
    expect(screen.getByText(/Bracelets/)).toBeInTheDocument();
    expect(screen.getByText(/18K/)).toBeInTheDocument();
    expect(screen.getByText(/Gmall Branch/)).toBeInTheDocument();
    expect(screen.getByText(/Original lot A-812/)).toBeInTheDocument();
    expect(screen.getByAltText('Rose Gold Bangle')).toHaveAttribute('src', 'bangle.jpg');
  });

  it('20b. lot details are read-only in relist mode (history is never rewritten)', () => {
    renderWizard();
    expect(screen.queryByLabelText('Item Name')).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be changed here/)).toBeInTheDocument();
  });

  it('22. Back and Continue move through the steps', async () => {
    renderWizard();
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
    expect(screen.getByText('Auction start date')).toBeInTheDocument();
    clickBack();
    await waitFor(() => expect(screen.getByText('Step 1 of 4 · Lot Details')).toBeInTheDocument());
  });

  it('21. an invalid schedule blocks Continue', async () => {
    // Seed an unfinished relist draft whose schedule is in the past.
    localStorage.setItem('atany_relist_draft:auc-1', JSON.stringify({
      name: 'Rose Gold Bangle', startPrice: '50000',
      start: '2020-01-01T10:00', end: '2020-01-02T10:00', step: 1,
    }));
    renderWizard();
    await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
    clickContinue();
    // Blocked: the shared schedule validation must keep the wizard on step 2.
    await waitFor(() => expect(screen.getByText(/Auction start cannot be in the past/)).toBeInTheDocument());
    expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument();
  });

  it('24. Review shows the selected schedule + bidding values and the relist notice', async () => {
    renderWizard();
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 3 of 4 · Bidding Rules')).toBeInTheDocument());
    // Prefilled from the source auction
    expect(screen.getByLabelText('Starting Price (₱)')).toHaveValue(50000);
    expect(screen.getByLabelText('Minimum Bid Increment (₱)')).toHaveValue(2500);
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument());
    expect(screen.getByText('₱50,000')).toBeInTheDocument();
    expect(screen.getByText('₱2,500')).toBeInTheDocument();
    expect(screen.getByText(/This creates a new auction/)).toBeInTheDocument();
    expect(screen.getByText(/original ended auction and its bidding history will remain unchanged/i)).toBeInTheDocument();
  });

  it('25. submits the relist payload with the validated schedule + bidding rules', async () => {
    const { onSubmit } = renderWizard();
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 3 of 4 · Bidding Rules')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Starting Price (₱)'), { target: { value: '60000' } });
    fireEvent.change(screen.getByLabelText('Minimum Bid Increment (₱)'), { target: { value: '3000' } });
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Relist Auction' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.start_price).toBe(60000);
    expect(payload.minimum_bid_increment).toBe(3000);
    expect(payload.start_time).toBeTruthy();
    expect(payload.end_time).toBeTruthy();
    // No create-only fields leak into the relist payload
    expect(payload.name).toBeUndefined();
    expect(payload.image_url).toBeUndefined();
  });

  it('26. the submit button is disabled while the request is in flight (no double submit)', async () => {
    let resolve;
    const onSubmit = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderWizard({ onSubmit });
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 2 of 4 · Schedule')).toBeInTheDocument());
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 3 of 4 · Bidding Rules')).toBeInTheDocument());
    clickContinue();
    await waitFor(() => expect(screen.getByText('Step 4 of 4 · Review')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Relist Auction' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Relisting…' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Relisting…' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve({ id: 'new-auc' });
  });

  it('23. the stepper renders four steps with horizontal connector lines', () => {
    renderWizard();
    const steps = document.querySelectorAll('.wizard-steps .wizard-step');
    expect(steps.length).toBe(4);
    expect(steps[0].className).toContain('active');
    // Source-level: the connector is a pseudo-element between the circles.
    expect(cssSrc).toMatch(/\.wizard-step:not\(:last-child\)::after \{[^}]*content:\s*''/);
    expect(cssSrc).toMatch(/\.wizard-step:not\(:last-child\)::after \{[^}]*left:\s*calc\(50% \+ 18px\)/);
    expect(cssSrc).toMatch(/\.wizard-step:not\(:last-child\)::after \{[^}]*right:\s*calc\(-50% \+ 18px\)/);
    expect(cssSrc).toMatch(/\.wizard-step\.done:not\(:last-child\)::after \{ background: var\(--success\); \}/);
  });

  it('5. the relist draft uses its own localStorage key (never the create draft)', () => {
    localStorage.setItem('atany_auction_lot_draft', JSON.stringify({ name: 'CREATE DRAFT' }));
    renderWizard();
    // The relist session autosaves under its own key.
    expect(localStorage.getItem('atany_relist_draft:auc-1')).toBeTruthy();
    expect(localStorage.getItem('atany_relist_draft:auc-1')).not.toContain('CREATE DRAFT');
    // The create-auction draft is untouched.
    expect(localStorage.getItem('atany_auction_lot_draft')).toContain('CREATE DRAFT');
  });
});
