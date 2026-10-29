import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { vi, afterEach, beforeEach } from 'vitest';
import { BidStepper } from '../BidStepper';
import { DetailModal } from '../DetailModal';
import { incrementOf, minimumNextBid, DEFAULT_MIN_INCREMENT } from '../../../../shared/lib/bidMinimum';

const now = Date.now();
const liveAuction = (over = {}) => ({
  id: 'a1', name: 'Ruby Ring', category: 'Rings', img: 'x.jpg',
  branch_name: 'Gmall Branch', status: 'live',
  startTime: new Date(now - 3600000).toISOString(), start_time: new Date(now - 3600000).toISOString(),
  endTime: new Date(now + 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  startPrice: 70000, start_price: 70000, currentBid: 74000, current_bid: 74000,
  minimum_bid_increment: 2000, bids: 2, bidders: [], desc: 'Nice ring.',
  ...over,
});

beforeEach(() => {});
afterEach(() => cleanup());

function bidInput() { return screen.getByLabelText('Your bid amount'); }

describe('bidMinimum helper', () => {
  it('incrementOf prefers per-auction value, falls back to 1000', () => {
    expect(incrementOf({ minimum_bid_increment: 2000 })).toBe(2000);
    expect(incrementOf({})).toBe(DEFAULT_MIN_INCREMENT);
    expect(incrementOf({ minimum_bid_increment: 0 })).toBe(DEFAULT_MIN_INCREMENT);
  });
  it('minimumNextBid 74000+2000=76000', () => {
    expect(minimumNextBid(74000, 2000)).toBe(76000);
  });
  it('different auctions can have different increments', () => {
    expect(incrementOf({ minimum_bid_increment: 2500 })).toBe(2500);
    expect(incrementOf({ minimum_bid_increment: 5000 })).toBe(5000);
  });
});

describe('BidStepper increment stepper (70000 + 500)', () => {
  const renderStepper = (props = {}, bidProps = {}) =>
    render(<BidStepper currentBid={70000} minIncrement={500} onPlaceBid={async () => ({})} size="large" {...props} {...bidProps} />);

  it('1. minimum next is 70500', () => {
    renderStepper();
    expect(bidInput().value).toBe('70500');
  });

  it('2. selector initializes at minimum (never current bid)', () => {
    renderStepper();
    expect(bidInput().value).not.toBe('70000');
    expect(bidInput().value).toBe('70500');
  });

  it('3/4. + once 71000, + twice 71500', () => {
    renderStepper();
    fireEvent.click(screen.getByRole('button', { name: 'Increase bid by ₱500' }));
    expect(bidInput().value).toBe('71000');
    fireEvent.click(screen.getByRole('button', { name: 'Increase bid by ₱500' }));
    expect(bidInput().value).toBe('71500');
  });

  it('5/6. − back to 71000 then 70500', () => {
    renderStepper();
    const plus = screen.getByRole('button', { name: 'Increase bid by ₱500' });
    const minus = screen.getByRole('button', { name: 'Decrease bid by ₱500' });
    fireEvent.click(plus); fireEvent.click(plus);
    expect(bidInput().value).toBe('71500');
    fireEvent.click(minus);
    expect(bidInput().value).toBe('71000');
    fireEvent.click(minus);
    expect(bidInput().value).toBe('70500');
  });

  it('7. − disabled at minimum', () => {
    renderStepper();
    expect(screen.getByRole('button', { name: 'Decrease bid by ₱500' })).toBeDisabled();
  });

  it('8/9. manual 80000 then +/− steps by increment', () => {
    renderStepper();
    fireEvent.change(bidInput(), { target: { value: '80000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase bid by ₱500' }));
    expect(bidInput().value).toBe('80500');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease bid by ₱500' }));
    expect(bidInput().value).toBe('80000');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease bid by ₱500' }));
    expect(bidInput().value).toBe('79500');
  });

  it('manual input stays editable (not locked to minimum)', () => {
    const onPlaceBid = vi.fn(async () => ({}));
    render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '77000' } });
    expect(bidInput().value).toBe('77000');
  });

  it.each([['75000', false], ['75500', false], ['74000', false], ['76000', true], ['77000', true], ['80000', true], ['100000', true]])(
    'typed %s → %s',
    async (typed, allowed) => {
      const onPlaceBid = vi.fn(async () => ({}));
      render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
      fireEvent.change(bidInput(), { target: { value: typed } });
      fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
      if (allowed) {
        await waitFor(() => expect(onPlaceBid).toHaveBeenCalledWith(Number(typed)));
      } else {
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(onPlaceBid).not.toHaveBeenCalled();
        expect(screen.getByText(/at least ₱76,000/)).toBeInTheDocument();
      }
    }
  );

  it('no exact-multiple rule: 77000 and 81000 accepted', async () => {
    const onPlaceBid = vi.fn(async () => ({}));
    render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '81000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(onPlaceBid).toHaveBeenCalledWith(81000));
  });

  it('BID_TOO_LOW shows friendly error and adopts server minimum', async () => {
    const onPlaceBid = vi.fn(async () => {
      const e = new Error('Your bid is too low. The minimum next bid is ₱82,000.');
      e.code = 'BID_TOO_LOW'; e.minimum_bid = 82000; e.current_bid = 80000; e.minimum_bid_increment = 2000;
      throw e;
    });
    render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '76000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(screen.getByText(/minimum next bid is ₱82,000/i)).toBeInTheDocument());
    // Typed value kept visible for correction
    expect(bidInput().value).toBe('76000');
  });

  it('accepted bid clears error and resets to minimum', async () => {
    const onPlaceBid = vi.fn(async () => ({}));
    render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '80000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place Bid' }));
    await waitFor(() => expect(onPlaceBid).toHaveBeenCalledWith(80000));
    expect(bidInput().value).toBe('76000');
  });

  it('11. Place Bid disabled below minimum', () => {
    const onPlaceBid = vi.fn(async () => ({}));
    render(<BidStepper currentBid={70000} minIncrement={500} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '70000' } });
    expect(screen.getByRole('button', { name: 'Place Bid' })).toBeDisabled();
    expect(screen.getByText(/at least ₱70,500/)).toBeInTheDocument();
  });

  it('15. different auctions use their own increments', () => {
    const onPlaceBid = vi.fn(async () => ({}));
    const { unmount } = render(<BidStepper currentBid={70000} minIncrement={500} onPlaceBid={onPlaceBid} size="large" />);
    expect(bidInput().value).toBe('70500');
    unmount();
    render(<BidStepper currentBid={70000} minIncrement={2500} onPlaceBid={onPlaceBid} size="large" />);
    expect(bidInput().value).toBe('72500');
  });

  it('13/14. realtime higher bid auto-raises an invalid selector to the new minimum', async () => {
    const onPlaceBid = vi.fn(async () => ({}));
    const { rerender } = render(<BidStepper currentBid={74000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    fireEvent.change(bidInput(), { target: { value: '76000' } });
    rerender(<BidStepper currentBid={80000} minIncrement={2000} onPlaceBid={onPlaceBid} size="large" />);
    expect(bidInput().value).toBe('82000');
  });
});

describe('DetailModal increment display', () => {
  const base = { isFavorited: false, isNotifying: false, onClose: () => {}, onToggleFavorite: () => {}, onToggleNotify: () => {}, onPlaceBid: async () => ({}) };
  it('live modal shows increment + minimum + helper', () => {
    render(<DetailModal auction={liveAuction()} {...base} />);
    expect(screen.getByText('Minimum Increment')).toBeInTheDocument();
    expect(screen.getByText('₱2,000')).toBeInTheDocument();
    expect(screen.getByText('₱76,000')).toBeInTheDocument();
    expect(screen.getByText(/Enter ₱76,000 or higher/)).toBeInTheDocument();
  });

  it('scheduled shows increment but Notify instead of bid', () => {
    render(<DetailModal auction={liveAuction({ status: 'scheduled', startTime: new Date(now + 3600000).toISOString(), start_time: new Date(now + 3600000).toISOString() })} {...base} />);
    expect(screen.getByText('Notify Me When Live')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your bid amount')).toBeNull();
  });

  it('ended hides bid UI', () => {
    render(<DetailModal auction={liveAuction({ status: 'ended', endTime: new Date(now - 1000).toISOString(), end_time: new Date(now - 1000).toISOString() })} {...base} />);
    expect(screen.getByText('Auction Has Ended')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your bid amount')).toBeNull();
  });
});

describe('fixed-1000 assumptions removed', () => {
  it('BidBox no longer subtracts a hardcoded 1000', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const box = fs.readFileSync(path.join(here, '../BidBox.jsx'), 'utf8');
    expect(box).not.toMatch(/minBid\s*-\s*1000/);
    const stepper = fs.readFileSync(path.join(here, '../BidStepper.jsx'), 'utf8');
    expect(stepper).not.toMatch(/const MIN_INCREMENT = 1000/);
  });
});
