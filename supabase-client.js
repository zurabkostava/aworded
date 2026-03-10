
// supabase-client.js

const SUPABASE_URL = 'https://wdgvxerfxwtmpqztwgtj.supabase.co';

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkZ3Z4ZXJmeHd0bXBxenR3Z3RqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNDgwOTYsImV4cCI6MjA4ODcyNDA5Nn0.7hbSdWzo9N5b0OoxGHRVgyMRoUgggOnqVS-i20q_dUk';



/**

 * აქ ვქმნით ჩვენს კლიენტს.

 * ვიძახებთ გლობალურ 'supabase' ობიექტს (რომელიც CDN-დან მოდის)

 * და მისგან ვქმნით ახალ კლიენტს, რომელსაც დავარქმევთ 'supabaseClient'.

 */

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);