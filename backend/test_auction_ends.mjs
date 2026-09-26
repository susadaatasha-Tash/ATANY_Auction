import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const apiBase = process.env.VITE_API_URL || 'http://localhost:4000';

async function test(){
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.signInWithPassword({ email: 'maria.santos@email.com', password: 'Customer123!' });
  if(error){ console.log('login err', error.message); return; }
  const token = data.session.access_token;
  console.log('logged in');
  const res = await fetch(`${apiBase}/customer/auctions`, { headers: { Authorization: `Bearer ${token}` } });
  console.log('status', res.status);
  const body = await res.text();
  const json = JSON.parse(body);
  console.log('auctions', json.length);
  for(let a of json.slice(0,3)){
    console.log('auction', a.id.slice(0,8), 'name', a.name, 'status', a.status, 'endsInSec', a.endsInSec, 'endTime', a.endTime, 'end_time', a.end_time, 'currentBid', a.currentBid, 'bids', a.bids);
  }
  // Also test live filter
  const res2 = await fetch(`${apiBase}/customer/auctions?status=live`, { headers: { Authorization: `Bearer ${token}` } });
  const json2 = JSON.parse(await res2.text());
  console.log('live', json2.length, json2.slice(0,2).map(a=> ({id:a.id.slice(0,8), endsInSec:a.endsInSec, status:a.status})) );
  // Test detail
  if(json.length){
    const id = json[0].id;
    const res3 = await fetch(`${apiBase}/customer/auctions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const json3 = JSON.parse(await res3.text());
    console.log('detail', json3.id.slice(0,8), 'endsInSec', json3.endsInSec, 'bidders', json3.bidders?.length, 'bids', json3.bids);
  }
  // Test public live feed
  const res4 = await fetch(`${apiBase}/api/auctions/live`);
  const json4 = JSON.parse(await res4.text());
  console.log('public live', json4.length, json4.slice(0,2).map(a=> ({id:a.id.slice(0,8), endsInSec:a.endsInSec, status:a.status, end_time:a.end_time, endTime:a.endTime})) );
}
test().catch(e=>console.log(e));
