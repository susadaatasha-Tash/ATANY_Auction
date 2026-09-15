// frontend/src/shared/lib/supabaseClient.js
// Spec 1: DB/Auth/Storage/Realtime on Supabase.
// Keys via env — never hardcode (spec 5.6). RLS policies enforce per spec 5.4.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';

export const supabase = createClient(url, key);
