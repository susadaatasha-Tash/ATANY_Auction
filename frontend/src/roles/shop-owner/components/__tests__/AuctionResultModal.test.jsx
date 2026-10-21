// frontend/src/roles/shop-owner/components/__tests__/AuctionResultModal.test.jsx
// Seller Auction Result modal: product summary, result status, metrics,
// bidder leaderboard, no-bid state and the footer actions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import { AuctionResultModal } from '../AuctionResultModal';

const AUCTION = {
  id: 'auc-1',
  title: 'Rose Gold Bangle',
  category: 'Bracelets',
  image_url: 'bangle.jpg',
  branch: 'Gmall Branch',
  status: 'ended',
  auction_code: 'A-812',
  lot_code: 'A-812',
  start_time: '2026-09-14T07:16:42.000Z',
  end_time: '2026-09-15T07:16:42.000Z',
};

function resultPayload(overrides = {}) {
  return {
    auction: { ...AUCTION, id: 'auc-1' },
    product: { id: 'p1', name: 'Rose Gold Bangle', category: 'Bracelets', karat_weight: '18K', description: 'Nice piece', image_url: 'bangle.jpg' },
    branch: { id: 'b1', name: 'Gmall Branch' },
    result: {
      state: 'payment_pending', label: 'Winner confirmed — payment pending',
      winner_confirmed: true, final_bid: 55000, highest_bid: 55000,
      total_bids: 14, watcher_count: 63, order_status: 'pending',
      payment_deadline: '2026-09-22T07:16:42.000Z', winner_confirmed_at: '2026-09-15T07:16:42.000Z', winner_rank: 1,
    },
    winner: { id: 'u1', name: 'Anthony Ong', amount: 55000 },
    leaderboard: [
      { rank: 1, bidder_id: 'u1', bidder_name: 'Anthony Ong', amount: 55000, is_winner: true, is_leading: false, is_top_bidder: true },
      { rank: 2, bidder_id: 'u2', bidder_name: 'Maria Santos', amount: 52000, is_winner: false, is_leading: false, is_top_bidder: false },
      { rank: 3, bidder_id: 'u3', bidder_name: 'Bianca Lim', amount: 50000, is_winner: false, is_leading: false, is_top_bidder: false },
    ],
    can_relist: true,
    ...overrides,
  };
}

function renderModal({ payload = resultPayload(), onClose = vi.fn(), onRelist = vi.fn() } = {}) {
  apiFetch.mockResolvedValue(payload);
  const utils = render(
    <AuctionResultModal auction={AUCTION} open onClose={onClose} onRelist={onRelist} />
  );
  return { ...utils, onClose, onRelist };
}

describe('AuctionResultModal', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('fetches the authoritative result for the auction on open', async () => {
    renderModal();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/shop-owner/auctions/auc-1/result'));
  });

  it('29. renders the product summary (image, title, category · branch)', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('Rose Gold Bangle')).toBeInTheDocument());
    expect(screen.getByAltText('Rose Gold Bangle')).toHaveAttribute('src', 'bangle.jpg');
    expect(screen.getByText(/Bracelets · Gmall Branch/)).toBeInTheDocument();
  });

  it('shows the real auction code as the header eyebrow (never a hardcoded lot number)', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('A-812')).toBeInTheDocument());
    expect(screen.getByText('Auction result')).toBeInTheDocument();
    expect(screen.queryByText(/LOT-3997/)).not.toBeInTheDocument();
  });

  it('30. renders the result status and the winner from the server payload', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('Winner confirmed — payment pending')).toBeInTheDocument());
    expect(screen.getByText('Won by Anthony Ong')).toBeInTheDocument();
  });

  it('31. renders the real metrics (final bid, total bids, watchers)', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('Current payable amount')).toBeInTheDocument());
    // ₱55,000 appears as the final-bid metric and as the winning bid row.
    expect(screen.getAllByText('₱55,000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('63')).toBeInTheDocument();
    expect(screen.getByText('Total bids')).toBeInTheDocument();
    expect(screen.getByText('Watchers')).toBeInTheDocument();
  });

  it('32. renders the leaderboard rows with rank, name, amount and chip', async () => {
    renderModal();
    await waitFor(() => expect(screen.getByText('Anthony Ong')).toBeInTheDocument());
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Bianca Lim')).toBeInTheDocument();
    expect(screen.getByText('Winner')).toBeInTheDocument();
    expect(screen.getAllByText('Outbid').length).toBe(2);
    expect(screen.getByText('₱52,000')).toBeInTheDocument();
  });

  it('32b. renders a single-bidder leaderboard (no empty padding rows)', async () => {
    const payload = resultPayload({
      leaderboard: [{ rank: 1, bidder_id: 'u1', bidder_name: 'Anthony Ong', amount: 55000, is_winner: true, is_top_bidder: true }],
      result: { ...resultPayload().result, total_bids: 1 },
    });
    renderModal({ payload });
    await waitFor(() => expect(screen.getByText('Anthony Ong')).toBeInTheDocument());
    expect(screen.queryByText('Outbid')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.result-leader__row').length).toBe(1);
  });

  it('33. the no-bid state is rendered (never "Sold")', async () => {
    const base = resultPayload();
    const payload = resultPayload({
      leaderboard: [],
      winner: null,
      result: { state: 'no_bids', label: 'Ended — no bids', winner_confirmed: false, final_bid: 0, highest_bid: 0, total_bids: 0, watcher_count: 0, order_status: null, payment_deadline: null, winner_confirmed_at: null, winner_rank: null },
    });
    renderModal({ payload });
    await waitFor(() => expect(screen.getByText('Ended — no bids')).toBeInTheDocument());
    expect(screen.getByText('No confirmed winner')).toBeInTheDocument();
    expect(screen.getByText(/ended without any bids/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sold/)).not.toBeInTheDocument();
  });

  it('33b. an expired winner is shown as expired, not confirmed', async () => {
    const base = resultPayload();
    const payload = resultPayload({
      winner: null,
      leaderboard: [],
      result: { ...base.result, state: 'winner_expired', label: 'Winner expired — payment deadline passed', winner_confirmed: false },
    });
    renderModal({ payload });
    await waitFor(() => expect(screen.getByText('Winner expired — payment deadline passed')).toBeInTheDocument());
    expect(screen.getByText('No confirmed winner')).toBeInTheDocument();
  });

  it('shows the CURRENT assigned winner (reassigned) with their own amount and rank, not the highest historical bid', async () => {
    // The order was reassigned: Britz is now the payable winner at 65,000,
    // while Maria's 71,000 stays the highest bid ever placed.
    const payload = resultPayload({
      result: {
        state: 'payment_pending', label: 'Winner confirmed — payment pending',
        winner_confirmed: true, final_bid: 65000, highest_bid: 71000,
        total_bids: 14, watcher_count: 63, order_status: 'pending',
        payment_deadline: '2026-10-29T20:30:00.000Z', winner_confirmed_at: '2026-10-22T20:30:00.000Z', winner_rank: 2,
      },
      winner: { id: 'u-britz', name: 'Britz Susada', amount: 65000 },
      leaderboard: [
        { rank: 1, bidder_id: 'u-maria', bidder_name: 'Maria Santos', amount: 71000, is_winner: false, is_leading: false, is_top_bidder: true },
        { rank: 2, bidder_id: 'u-britz', bidder_name: 'Britz Susada', amount: 65000, is_winner: true, is_leading: false, is_top_bidder: false },
      ],
    });
    renderModal({ payload });
    await waitFor(() => expect(screen.getByText(/Won by Britz Susada/)).toBeInTheDocument());
    // The payable amount is the reassigned winner's own bid.
    expect(screen.getByText('Current payable amount')).toBeInTheDocument();
    expect(screen.getAllByText('₱65,000').length).toBeGreaterThan(0);
    expect(screen.getByText('Winner rank')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    // The historical highest bid is still shown, clearly labelled.
    expect(screen.getByText(/Highest bid placed: ₱71,000/)).toBeInTheDocument();
    expect(screen.getByText(/Payment due by/)).toBeInTheDocument();
  });

  it('34. the Relist button hands the ended auction to the relist flow', async () => {
    const { onRelist } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: /Relist/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Relist/ }));
    expect(onRelist).toHaveBeenCalledWith(expect.objectContaining({ id: 'auc-1' }));
  });

  it('35. Done closes the modal', async () => {
    const { onClose } = renderModal();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a loading state while the result is fetched', async () => {
    let resolve;
    apiFetch.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<AuctionResultModal auction={AUCTION} open onClose={vi.fn()} onRelist={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Loading auction result/)).toBeInTheDocument());
    resolve(resultPayload());
    await waitFor(() => expect(screen.getByText('Winner confirmed — payment pending')).toBeInTheDocument());
  });

  it('shows a safe error state when the result request fails', async () => {
    apiFetch.mockRejectedValue(new Error('Auction not found'));
    render(<AuctionResultModal auction={AUCTION} open onClose={vi.fn()} onRelist={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Auction not found')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
