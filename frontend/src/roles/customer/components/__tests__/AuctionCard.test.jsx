import { render, screen } from '@testing-library/react';
import { AuctionCard } from '../AuctionCard';
import { ToastProvider } from '../../../../shared/components/Toast';

const mock = { id: '1', name: 'Gold Ring', img: 'x.jpg', bids: 5, endsInSec: 3600, status: 'live', currentBid: 50000 };

test('AuctionCard shows LIVE and bid button', () => {
  render(
    <ToastProvider>
      <AuctionCard auction={mock} isWatched={false} onOpenDetail={() => {}} onToggleWatch={() => {}} onPlaceBid={() => {}} />
    </ToastProvider>
  );
  expect(screen.getByText('LIVE')).toBeInTheDocument();
  expect(screen.getByText('Bid')).toBeInTheDocument();
});
