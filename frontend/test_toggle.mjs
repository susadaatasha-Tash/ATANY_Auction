import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';

// Mock useAuth
vi.mock('./src/shared/hooks/useAuth', async () => {
  const actual = await vi.importActual('./src/shared/hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({ user: { id: 'test-id', email: 'test@test.com', user_metadata: {} } }),
  };
});

// Mock supabase
vi.mock('./src/shared/lib/supabaseClient', async () => {
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'test-id', user_metadata: {} } } } }),
        updateUser: async () => ({ error: null }),
      },
      from: () => ({ insert: async () => ({ error: null }) }),
    },
  };
});

vi.mock('./src/shared/components/Toast', () => ({
  useToast: () => () => {},
}));

import Settings from './src/roles/customer/pages/Settings.jsx';

async function run(){
  const { container } = render(React.createElement(Settings));
  console.log('Rendered, container innerHTML length', container.innerHTML.length);
  await new Promise(r=>setTimeout(r, 1000));
  console.log('After 1s, body', document.body.innerHTML.slice(0,500));
  const auctionText = screen.queryByText('Auction Updates');
  console.log('Found Auction Updates?', !!auctionText);
  if(auctionText){
    const toggle = auctionText.closest('div').parentElement.querySelector('button[role="switch"]');
    console.log('Found toggle?', !!toggle);
    if(toggle){
      console.log('Clicking toggle');
      fireEvent.click(toggle);
      await new Promise(r=>setTimeout(r, 500));
      console.log('After click, still has Auction Updates?', !!screen.queryByText('Auction Updates'));
      console.log('Body after click', document.body.innerHTML.slice(0,1000));
    }
  }
}

run().catch(e=>console.log('err',e, e.stack));
