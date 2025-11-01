// supabase-client.js
const SUPABASE_URL = 'https://abeiwwgmdldkemkkeyoq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiZWl3d2dtZGxka2Vta2tleW9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5NDg4NTksImV4cCI6MjA3NzUyNDg1OX0.cdolaC5fB-Pu2jr-38gHN8pKMO-MXDTxoKV5M41Fdko';

/**
 * აქ ვქმნით ჩვენს კლიენტს.
 * ვიძახებთ გლობალურ 'supabase' ობიექტს (რომელიც CDN-დან მოდის)
 * და მისგან ვქმნით ახალ კლიენტს, რომელსაც დავარქმევთ 'supabaseClient'.
 */
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);