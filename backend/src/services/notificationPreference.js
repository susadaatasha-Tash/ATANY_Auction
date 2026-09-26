// backend/src/services/notificationPreference.js
// Checks if a user wants a particular notification type based on their settings stored in auth.users raw_user_meta_data.settings
// Categories: auction_updates, bid_activity, order_updates, promotions_offers
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdmin = null;
if (supabaseUrl && supabaseServiceKey) {
  supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
}

// Map notification type/message to settings key
function categoryForNotification(type, message) {
  const msg = (message || '').toLowerCase();
  // Order updates: payout, order, purchase, shipping
  if (type === 'payout' || msg.includes('order') || msg.includes('purchase') || msg.includes('shipping') || msg.includes('payment')) {
    return 'order_updates';
  }
  // Bid activity: outbid, win, bidding
  if (msg.includes('outbid') || msg.includes('win') || msg.includes('bidding') || msg.includes('bid')) {
    // Distinguish from auction updates which are about live/ending soon
    // If message is about live auction starting or ending soon, it's auction_updates
    if (msg.includes('live auction') || msg.includes('ending soon') || msg.includes('new auction')) {
      return 'auction_updates';
    }
    return 'bid_activity';
  }
  // Auction updates: live, ending soon, new auction
  if (type === 'auction' && (msg.includes('live') || msg.includes('ending soon') || msg.includes('new auction') || msg.includes('auction updates'))) {
    return 'auction_updates';
  }
  // Promotions
  if (type === 'promotion' || msg.includes('promotion') || msg.includes('deal') || msg.includes('special')) {
    return 'promotions_offers';
  }
  // Default to auction_updates for generic auction type
  if (type === 'auction') return 'auction_updates';
  return null; // no specific preference, allow
}

export async function shouldDeliverNotification(userId, type, message) {
  if (!userId) return false;
  if (!supabaseAdmin) return true; // if no admin client, allow
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error || !data?.user) return true; // default allow if fetch fails
    const settings = data.user.user_metadata?.settings;
    if (!settings) return true; // no preferences set, default ON
    const category = categoryForNotification(type, message);
    if (!category) return true; // no category, allow (e.g., security notifications)
    // Check the specific preference, default true if missing
    if (settings[category] === false) return false;
    if (settings[category] === true) return true;
    // If setting is undefined, default true
    return true;
  } catch {
    return true;
  }
}

export async function createNotificationIfAllowed(userId, type, message, poolInstance) {
  if (!userId || !message) return false;
  const allowed = await shouldDeliverNotification(userId, type, message);
  if (!allowed) {
    console.log(`[notifications] Skipped ${type} for ${userId} due to preference ${type}:${message.slice(0,30)}`);
    return false;
  }
  const poolToUse = poolInstance || (await import('../db/pool.js')).pool;
  await poolToUse.query('INSERT INTO notifications (user_id, type, message) VALUES ($1,$2,$3)', [userId, type, message]);
  return true;
}
