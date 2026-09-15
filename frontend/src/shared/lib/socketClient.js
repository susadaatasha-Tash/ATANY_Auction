// frontend/src/shared/lib/socketClient.js
// Spec 1: Real-time live bidding via Socket.io or Supabase Realtime.
// Socket.io client — used by customer LiveAuctions for live current_bid updates.
import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export const socket = io(URL, { autoConnect: false });

// Usage in customer/components/AuctionCard:
// socket.on('bid:update', ({ auctionId, currentBid }) => setBid(currentBid))
