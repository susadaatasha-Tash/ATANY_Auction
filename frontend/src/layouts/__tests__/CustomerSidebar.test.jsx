import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CustomerLayout from '../CustomerLayout';
import MyPurchases from '../../roles/customer/pages/MyPurchases';
import MyBids from '../../roles/customer/pages/MyBids';
import { ToastProvider } from '../../shared/components/Toast';
import PurchaseWorkspace from '../../roles/customer/pages/PurchaseWorkspace';

// Keep the real layout, headers, sidebar, and pages together; stub only services.
vi.mock('../../shared/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'customer-1', email: 'customer@example.com', user_metadata: {} },
    preferredBranchId: 'branch-1',
    loading: false,
  }),
}));
vi.mock('../../shared/hooks/useBranch', () => ({
  BranchProvider: ({ children }) => children,
  useBranch: () => ({ branchId: 'branch-1', branchName: 'Test Branch', branches: [], loading: false }),
}));
vi.mock('../../shared/lib/apiClient', () => ({ apiFetch: async () => [] }));
vi.mock('../../shared/lib/supabaseClient', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'customer-1' } } }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  },
}));

afterEach(cleanup);

function renderPurchases(initial='/customer/purchases') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route element={<CustomerLayout />}>
            <Route path="/customer/purchases" element={<MyPurchases />} />
            <Route path="/customer/bids" element={<MyBids />} />
            <Route path="/customer/orders/:id/payment" element={<PurchaseWorkspace />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

const sidebar = () => screen.getByRole('complementary', { name: 'Primary navigation' });
const menu = () => screen.getByRole('button', { name: 'Open navigation menu' });

describe('Purchases sidebar integration', () => {
  it('payment confirmation keeps the purchases header without a duplicate Dashboard header',async()=>{
    renderPurchases('/customer/orders/order-1/payment');
    await screen.findByRole('dialog',{name:'Complete Your Payment'});
    expect(screen.queryByRole('heading',{name:'Dashboard'})).not.toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'My Purchases'})).toBeInTheDocument();
  });
  it('opens and closes the layout drawer from the Purchases hamburger', async () => {
    const user = userEvent.setup();
    renderPurchases();
    await screen.findByText('No purchases yet');

    expect(sidebar()).not.toHaveClass('open');
    await user.click(menu());
    expect(sidebar()).toHaveClass('open');
    expect(document.querySelector('.sidebar-backdrop')).toBeInTheDocument();

    await user.click(menu());
    expect(sidebar()).not.toHaveClass('open');
    expect(document.querySelector('.sidebar-backdrop')).not.toBeInTheDocument();
    expect(screen.getByText('No purchases yet')).toBeInTheDocument();
  });

  it('closes the drawer through the existing backdrop', async () => {
    const user = userEvent.setup();
    renderPurchases();
    await user.click(menu());
    expect(sidebar()).toHaveClass('open');
    fireEvent.click(document.querySelector('.sidebar-backdrop'));
    expect(sidebar()).not.toHaveClass('open');
    expect(document.querySelector('.sidebar-backdrop')).not.toBeInTheDocument();
  });

  it('uses the layout desktop collapse state without opening a backdrop', async () => {
    const user = userEvent.setup();
    renderPurchases();
    const collapse = screen.getByRole('button', { name: 'Toggle sidebar' });
    await user.click(collapse);
    expect(document.querySelector('.customer-app')).toHaveClass('sidebar-collapsed');
    expect(document.querySelector('.sidebar-backdrop')).not.toBeInTheDocument();
    await user.click(collapse);
    expect(document.querySelector('.customer-app')).not.toHaveClass('sidebar-collapsed');
  });

  it('supports Enter and Space on the native menu button', async () => {
    const user = userEvent.setup();
    renderPurchases();
    menu().focus();
    await user.keyboard('{Enter}');
    expect(sidebar()).toHaveClass('open');
    await user.keyboard(' ');
    expect(sidebar()).not.toHaveClass('open');
  });

  it('closes on navigation and keeps the other customer header synchronized', async () => {
    const user = userEvent.setup();
    renderPurchases();
    await user.click(menu());
    await user.click(screen.getByRole('link', { name: 'My Bids' }));
    await screen.findByRole('heading', { name: 'My Bids' });
    expect(sidebar()).not.toHaveClass('open');
    expect(document.querySelector('.sidebar-backdrop')).not.toBeInTheDocument();

    await user.click(menu());
    expect(sidebar()).toHaveClass('open');
    await user.click(screen.getByRole('link', { name: 'My Purchases' }));
    await screen.findByRole('heading', { name: 'My Purchases' });
    expect(sidebar()).not.toHaveClass('open');
    expect(screen.getAllByRole('complementary', { name: 'Primary navigation' })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    await user.click(screen.getByRole('link', { name: 'My Bids' }));
    expect(document.querySelector('.customer-app')).toHaveClass('sidebar-collapsed');
    await user.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(document.querySelector('.customer-app')).not.toHaveClass('sidebar-collapsed');
  });
});
