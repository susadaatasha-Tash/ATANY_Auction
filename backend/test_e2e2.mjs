import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
const url = 'https://yypjomqybhuuvkgkcqwm.supabase.co';
const anon = 'sb_publishable_gX4045DJqBDHh4A_OuBA7A_tlnoaoLh';
const supaShop = createClient(url, anon);
const supaCust = createClient(url, anon);
const API = 'http://localhost:4000';

const { data: shopData, error: shopErr } = await supaShop.auth.signInWithPassword({ email: 'contact@goldenheritage.ph', password: 'ShopOwner123!' });
if (shopErr) { console.error('shop login', shopErr); process.exit(1); }
const shopToken = shopData.session.access_token;
console.log('shop ok', shopData.user.email);
const now = new Date();
const start = new Date(now.getTime() + 3*60*1000);
const end = new Date(now.getTime() + 8*60*1000);
console.log('start', start.toISOString(), 'end', end.toISOString());
const createRes = await fetch(`${API}/shop-owner/auctions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shopToken}` },
  body: JSON.stringify({ name: `E2E Test ${Date.now()}`, category: 'Rings', karat: '18K', startPrice: 5000, desc: 'e2e', start_time: start.toISOString(), end_time: end.toISOString() })
});
const createJson = await createRes.json();
console.log('create', createRes.status, createJson.id?.slice(0,8), createJson.start_time, createJson.status);
if (!createRes.ok) process.exit(1);
const auctionId = createJson.id;
const { data: custData } = await supaCust.auth.signInWithPassword({ email: 'maria.santos@email.com', password: 'Customer123!' });
const custToken = custData.session.access_token;
console.log('cust ok', custData.user.email);
async function custFetch(p, opts={}) {
  const h = { ...opts.headers, Authorization: `Bearer ${custToken}`, 'Content-Type': 'application/json' };
  const r = await fetch(`${API}${p}`, { ...opts, headers: h });
  const j = await r.json().catch(()=>null);
  return { status: r.status, json: j };
}
const list1 = await custFetch('/customer/auctions');
const found = list1.json.find(a=>a.id===auctionId);
console.log('found', found ? `${found.status} startsIn ${found.startsInSec} endsIn ${found.endsInSec}` : 'no');
if (found) {
  const s=new Date(found.startTime), e=new Date(found.endTime), n=new Date();
  const st=n<s?'scheduled':n>=e?'ended':'live';
  const cd=st==='scheduled'?Math.floor((s-n)/1000):st==='live'?Math.floor((e-n)/1000):0;
  console.log('frontend', st, cd, st==='scheduled'?'Starts in':'Ends in', Math.abs(cd-180)<20?'PASS':'FAIL');
}
const tog = await custFetch('/customer/reminders', { method: 'POST', body: JSON.stringify({ auction_id: auctionId }) });
console.log('notify', tog.status);
const rem = await custFetch('/customer/reminders');
console.log('reminders', rem.json.some(r=>r.auction_id===auctionId)?'HAS':'NO');
console.log('auction', auctionId);
