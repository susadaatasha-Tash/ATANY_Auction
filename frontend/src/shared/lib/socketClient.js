// frontend/src/shared/lib/socketClient.js
// Spec 1: Real-time live bidding via Socket.io.
// Priority 1 / H1: authenticate handshake with Supabase access token.
// Private user rooms are joined server-side from the verified token — never from client ids.
import { io } from 'socket.io-client';
import { supabase } from './supabaseClient';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const socket = io(URL, {
  autoConnect: false,
  auth: (cb) => {
    supabase.auth
      .getSession()
      .then(({ data }) => cb({ token: data.session?.access_token }))
      .catch(() => cb({ token: null }));
  },
});

// Usage in customer/components/AuctionCard:
// socket.on('bid:update', ({ auctionId, currentBid }) => setBid(currentBid))
// Messages: socket.connect() only — server joins user:<authenticated-id>
