// Supabase Edge Function: get-push-notification
// Called by service worker on push event to get queued notification content
// Auth: push endpoint URL itself acts as identifier (only the browser knows its own endpoint)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const url = new URL(req.url)
    const endpoint = url.searchParams.get('endpoint')

    if (!endpoint) {
      return new Response(JSON.stringify({ title: 'AWorded', body: 'დროა ისწავლო!' }), { headers: CORS })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Find user by their push endpoint
    const { data: sub } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .eq('endpoint', endpoint)
      .single()

    if (!sub) {
      return new Response(JSON.stringify({ title: 'AWorded', body: 'დროა ისწავლო!' }), { headers: CORS })
    }

    // Get oldest pending notification for this user
    const { data: notif } = await supabase
      .from('push_queue')
      .select('*')
      .eq('user_id', sub.user_id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (notif) {
      // Delete it so it's not shown twice
      await supabase.from('push_queue').delete().eq('id', notif.id)
      return new Response(JSON.stringify({ title: notif.title, body: notif.body }), { headers: CORS })
    }

    return new Response(JSON.stringify({ title: 'AWorded', body: 'დროა ისწავლო!' }), { headers: CORS })
  } catch (err) {
    return new Response(JSON.stringify({ title: 'AWorded', body: 'დროა ისწავლო!' }), { headers: CORS })
  }
})
