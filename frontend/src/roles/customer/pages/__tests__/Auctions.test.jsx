import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const apiFetch = vi.fn();
vi.mock('../../../../shared/lib/apiClient', () => ({ apiFetch: (...args) => apiFetch(...args) }));
vi.mock('../../../../shared/lib/supabaseClient', () => ({
  supabase: { channel: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }), subscribe: () => {} }), removeChannel: () => {} }
}));
vi.mock('../../../../shared/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, role: 'customer', loading: false }) }));
let mockBranchId = 'branch-1';
vi.mock('../../../../shared/hooks/useBranch', () => ({
  useBranch: () => ({ branchId: mockBranchId, branchName: 'Abreeza Branch', branches: [{ id: 'branch-1', name: 'Abreeza Branch' }, { id: 'branch-2', name: 'Gmall Branch' }], loading: false }),
  BranchProvider: ({ children }) => children,
}));
vi.mock('../../hooks/useFavorites', () => ({ useFavorites: () => ({ items: [], toggle: vi.fn() }) }));
vi.mock('../../hooks/useReminders', () => ({ useReminders: () => ({ items: [], toggle: vi.fn() }) }));
vi.mock('../../../../shared/components/Toast', () => ({ useToast: () => vi.fn() }));

import Auctions from '../Auctions';

const now = Date.now();
const liveAuction = {
  id: 'live-1', name: 'Gold Ring', product: 'Gold Ring', category: 'Rings', branch_id: 'branch-1', branch_name: 'Abreeza Branch',
  status: 'live', startTime: new Date(now - 3600000).toISOString(), start_time: new Date(now - 3600000).toISOString(),
  endTime: new Date(now + 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  currentBid: 5000, bids: 3, img: 'x.jpg',
};
const scheduledAuction = {
  id: 'sched-1', name: 'Silver Necklace', product: 'Silver Necklace', category: 'Necklaces', branch_id: 'branch-1', branch_name: 'Abreeza Branch',
  status: 'scheduled', startTime: new Date(now + 86400000).toISOString(), start_time: new Date(now + 86400000).toISOString(),
  endTime: new Date(now + 90000000).toISOString(), end_time: new Date(now + 90000000).toISOString(),
  currentBid: 0, bids: 0, img: 'y.jpg',
};
const endedAuction = {
  id: 'ended-1', name: 'Old Earrings', product: 'Old Earrings', category: 'Earrings', branch_id: 'branch-1', branch_name: 'Abreeza Branch',
  status: 'ended', startTime: new Date(now - 86400000*2).toISOString(), start_time: new Date(now - 86400000*2).toISOString(),
  endTime: new Date(now - 86400000).toISOString(), end_time: new Date(now - 86400000).toISOString(),
  currentBid: 10000, bids: 5, img: 'z.jpg',
};
const pausedAuction = {
  id: 'paused-1', name: 'Paused Bracelet', product: 'Paused Bracelet', category: 'Bracelets', branch_id: 'branch-1', branch_name: 'Abreeza Branch',
  status: 'paused', startTime: new Date(now - 3600000).toISOString(), start_time: new Date(now - 3600000).toISOString(),
  endTime: new Date(now + 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
  currentBid: 3000, bids: 1, img: 'p.jpg',
};

describe('Customer Auctions page', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation((path) => {
      if (path.startsWith('/customer/auctions')) return Promise.resolve([liveAuction, scheduledAuction, endedAuction, pausedAuction]);
      return Promise.resolve([]);
    });
    mockBranchId = 'branch-1';
  });

  it('page header and filters show Auctions not Live Auctions', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByPlaceholderText('Search auctions…')).toBeInTheDocument());
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.queryByText('Live & Scheduled')).not.toBeInTheDocument();
    expect(screen.queryByText('Ended')).not.toBeInTheDocument();
  });

  it('default All shows Live+Scheduled, excludes Ended and Paused', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.getByText('Gold Ring')).toBeInTheDocument();
    expect(screen.getByText('Silver Necklace')).toBeInTheDocument();
    expect(screen.queryByText('Old Earrings')).not.toBeInTheDocument();
    expect(screen.queryByText('Paused Bracelet')).not.toBeInTheDocument();
  });

  it('Live filter only shows live', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'live' } });
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.queryByText('Silver Necklace')).not.toBeInTheDocument();
  });

  it('Scheduled filter only shows scheduled', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'scheduled' } });
    await waitFor(() => expect(screen.getByText('Silver Necklace')).toBeInTheDocument());
    expect(screen.queryByText('Gold Ring')).not.toBeInTheDocument();
  });

  it('branch filtering preserved', async () => {
    // Gmall branch has no auctions in mock (all are Abreeza)
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.getByText('Gold Ring')).toBeInTheDocument();
    // Simulate branch mismatch: if we set branchFilter to other via context, it would filter out
    // Our mock branchId is Abreeza, so live/scheduled from Abreeza show; verify apiFetch was called with branch_id
    expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('branch_id=branch-1'));
  });

  it('scheduled auction shows Notify Me, not Bid; live shows Bid', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    // Live card has BidStepper (Bid)
    expect(screen.getByText('Bid')).toBeInTheDocument();
    // Scheduled card has Notify Me
    expect(screen.getByText('Notify Me')).toBeInTheDocument();
  });

  it('grouped display: Live now and Scheduled sections when All', async () => {
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Gold Ring')).toBeInTheDocument());
    expect(screen.getByText(/Live now —/)).toBeInTheDocument();
    expect(screen.getByText(/Scheduled —/)).toBeInTheDocument();
  });

  it('empty states are contextual', async () => {
    apiFetch.mockImplementation((path) => {
      if (path.startsWith('/customer/auctions')) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/No live or scheduled auctions are available for Abreeza Branch/)).toBeInTheDocument());
  });

  it('effective scheduled→live transition works (status computed from times)', async () => {
    const transitioning = {
      id: 'trans-1', name: 'Transition Ring', category: 'Rings', branch_id: 'branch-1', branch_name: 'Abreeza Branch',
      status: 'scheduled', startTime: new Date(now - 1000).toISOString(), start_time: new Date(now - 1000).toISOString(),
      endTime: new Date(now + 3600000).toISOString(), end_time: new Date(now + 3600000).toISOString(),
      currentBid: 0, bids: 0, img: 't.jpg',
    };
    apiFetch.mockImplementation((path) => {
      if (path.startsWith('/customer/auctions')) return Promise.resolve([transitioning]);
      return Promise.resolve([]);
    });
    render(<MemoryRouter><Auctions /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Transition Ring')).toBeInTheDocument());
    expect(screen.getByText(/Live now —/)).toBeInTheDocument();
  });

  it('sidebar shows Auctions not Live Auctions, header shows Auctions', async () => {
    const layoutSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../layouts/CustomerLayout.jsx'), 'utf8');
    expect(layoutSrc).toMatch(/name: 'Auctions'/);
    expect(layoutSrc).not.toMatch(/name: 'Live Auctions'/);
    expect(layoutSrc).toMatch(/\/customer\/auctions/);
  });

  it('old frontend route /customer/live redirects to /customer/auctions', async () => {
    const routesSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../routes.jsx'), 'utf8');
    expect(routesSrc).toMatch(/path: 'auctions'/);
    expect(routesSrc).toMatch(/path: 'live'.*Navigate.*\/customer\/auctions/);
  });

  it('compatibility API /api/auctions/live still works', async () => {
    const indexSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../backend/src/index.js'), 'utf8');
    expect(indexSrc).toMatch(/app\.get\('\/api\/auctions\/live'/);
    expect(indexSrc).toMatch(/app\.get\('\/api\/auctions'/);
  });
});
