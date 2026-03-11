// send-push: runs every minute via pg_cron
// finds matching schedules → gets random card → stores in push_queue → sends empty push

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function b64uEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const b = atob(s)
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out
}

async function vapidJwt(audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const hdr = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const pay = b64uEncode(new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 86400, sub: 'mailto:zurabkostava1@gmail.com' })))
  const unsigned = `${hdr}.${pay}`

  const pub = b64uDecode(VAPID_PUBLIC_KEY)
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: VAPID_PRIVATE_KEY,
    x: b64uEncode(pub.slice(1, 33)),
    y: b64uEncode(pub.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])

  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)))

  let raw: Uint8Array
  if (sig.length === 64) {
    raw = sig
  } else {
    raw = new Uint8Array(64)
    let o = 2
    o++; const rl = sig[o++]; const rb = sig.slice(o, o + rl); o += rl
    o++; const sl = sig[o++]; const sb = sig.slice(o, o + sl)
    rl <= 32 ? raw.set(rb, 32 - rl) : raw.set(rb.slice(rl - 32), 0)
    sl <= 32 ? raw.set(sb, 64 - sl) : raw.set(sb.slice(sl - 32), 32)
  }

  return `${unsigned}.${b64uEncode(raw)}`
}

async function sendPush(endpoint: string): Promise<void> {
  const u = new URL(endpoint)
  const jwt = await vapidJwt(`${u.protocol}//${u.host}`)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'TTL': '86400', 'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
}

Deno.serve(async () => {
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Current time in Tbilisi (UTC+4)
    const now = new Date()
    const t = new Date(now.getTime() + 4 * 60 * 60 * 1000)
    const day = t.getUTCDay()
    const time = `${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`

    const { data: schedules, error } = await db
      .from('notification_schedules')
      .select('*')
      .eq('enabled', true)
      .eq('time', time)
      .contains('days', [day])

    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!schedules?.length) return Response.json({ message: 'No notifications', time, day })

    // Clean up expired queue entries once before processing
    await db.from('push_queue').delete().lt('expires_at', now.toISOString())

    let sent = 0, errors = 0

    for (const s of schedules) {
      // Get random card
      let title = 'AWorded', body = 'დროა ისწავლო!'
      try {
        const params: Record<string, unknown> = {
          dict_id_input: s.dictionary_id || null,
          tag_names_input: s.tags?.length > 0 ? s.tags : null,
          progress_min_input: null,
          progress_max_input: null,
        }
        if (s.progress_range) {
          const [min, max] = s.progress_range.split('-')
          params.progress_min_input = parseInt(min)
          params.progress_max_input = parseInt(max)
        }
        const { data: card } = await db.rpc('get_random_card', params).single()
        if (card) { title = card.word || title; body = (card.main_translations || []).join(', ') || body }
      } catch { /* use defaults */ }

      // Get user's push subscriptions
      const { data: subs, error: subsErr } = await db.from('push_subscriptions').select('*').eq('user_id', s.user_id)
      console.log(`subs for schedule ${s.id}: ${subs?.length ?? 0}`, subsErr?.message ?? '')
      if (!subs?.length) continue

      for (const sub of subs) {
        // Store one queue entry PER DEVICE so each gets its own notification
        const { error: qErr } = await db.from('push_queue').insert({
          user_id: s.user_id, title, body, schedule_id: s.id, endpoint: sub.endpoint,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        })
        console.log(`queue insert for ${sub.endpoint.substring(0, 40)}: ${qErr ? 'FAILED: ' + qErr.message : 'OK'}`)
        if (qErr) { errors++; continue }

        try {
          await sendPush(sub.endpoint)
          sent++
        } catch (err: unknown) {
          errors++
          const msg = err instanceof Error ? err.message : String(err)
          console.error('Push failed:', msg)
          if (msg.includes('410') || msg.includes('404')) {
            await db.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }

    return Response.json({ sent, errors, time, day })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
