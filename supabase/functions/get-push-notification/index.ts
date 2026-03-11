// get-push-notification: called by service worker when push arrives
// identifies user by their push endpoint, returns queued notification content

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
}

const DEFAULT = { title: 'AWorded', body: 'დროა ისწავლო!' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const endpoint = new URL(req.url).searchParams.get('endpoint')
    if (!endpoint) return new Response(JSON.stringify(DEFAULT), { headers: CORS })

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    console.log('endpoint received:', endpoint.substring(0, 60))

    // Get notification queued specifically for this endpoint/device
    const { data: notif, error: notifErr } = await db
      .from('push_queue')
      .select('*')
      .eq('endpoint', endpoint)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    console.log('notif lookup:', notif?.title ?? 'NOT FOUND', notifErr?.message ?? '')

    if (!notif) return new Response(JSON.stringify(DEFAULT), { headers: CORS })

    // Delete it so it's not shown twice
    await db.from('push_queue').delete().eq('id', notif.id)

    return new Response(
      JSON.stringify({ title: notif.title, body: notif.body, schedule_id: notif.schedule_id }),
      { headers: CORS }
    )
  } catch {
    return new Response(JSON.stringify(DEFAULT), { headers: CORS })
  }
})
