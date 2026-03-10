// Supabase Edge Function: send-push
// Stores notification in push_queue, sends empty push trigger via VAPID

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

function base64UrlEncode(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function createVapidJwt(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { aud: audience, exp: now + 86400, sub: 'mailto:zurabkostava1@gmail.com' }

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const unsigned = `${headerB64}.${payloadB64}`

  // Extract x/y from uncompressed public key (0x04 + x(32) + y(32))
  const pubKeyBytes = base64UrlDecode(VAPID_PUBLIC_KEY)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: VAPID_PRIVATE_KEY,
    x: base64UrlEncode(pubKeyBytes.slice(1, 33)),
    y: base64UrlEncode(pubKeyBytes.slice(33, 65)),
  }

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned)))

  let rawSig: Uint8Array
  if (sig.length === 64) {
    rawSig = sig
  } else {
    // Parse DER format
    rawSig = new Uint8Array(64)
    let o = 2
    o++; const rLen = sig[o++]; const rBytes = sig.slice(o, o + rLen); o += rLen
    o++; const sLen = sig[o++]; const sBytes = sig.slice(o, o + sLen)
    rLen <= 32 ? rawSig.set(rBytes, 32 - rLen) : rawSig.set(rBytes.slice(rLen - 32), 0)
    sLen <= 32 ? rawSig.set(sBytes, 64 - sLen) : rawSig.set(sBytes.slice(sLen - 32), 32)
  }

  return `${unsigned}.${base64UrlEncode(rawSig)}`
}

async function sendEmptyPush(endpoint: string): Promise<void> {
  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt = await createVapidJwt(audience)

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Tbilisi time (UTC+4)
    const now = new Date()
    const tbilisi = new Date(now.getTime() + 4 * 60 * 60 * 1000)
    const currentDay = tbilisi.getUTCDay()
    const currentTime = `${String(tbilisi.getUTCHours()).padStart(2, '0')}:${String(tbilisi.getUTCMinutes()).padStart(2, '0')}`

    const { data: schedules, error } = await supabase
      .from('notification_schedules')
      .select('*')
      .eq('enabled', true)
      .eq('time', currentTime)
      .contains('days', [currentDay])

    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!schedules?.length) return Response.json({ message: 'No notifications', time: currentTime, day: currentDay })

    let sent = 0, errors = 0

    for (const schedule of schedules) {
      let title = 'AWorded', body = 'დროა ისწავლო!'

      try {
        const params: Record<string, unknown> = {
          dict_id_input: schedule.dictionary_id || null,
          tag_names_input: schedule.tags?.length > 0 ? schedule.tags : null,
          progress_min_input: null,
          progress_max_input: null,
        }
        if (schedule.progress_range) {
          const [min, max] = schedule.progress_range.split('-')
          params.progress_min_input = parseInt(min)
          params.progress_max_input = parseInt(max)
        }
        const { data: card } = await supabase.rpc('get_random_card', params).single()
        if (card) {
          title = card.word || 'AWorded'
          body = (card.main_translations || []).join(', ')
        }
      } catch { /* use defaults */ }

      // Store notification in queue for SW to fetch
      await supabase.from('push_queue').insert({ user_id: schedule.user_id, title, body, schedule_id: schedule.id })

      // Clean up expired entries
      await supabase.from('push_queue').delete().lt('expires_at', now.toISOString())

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', schedule.user_id)

      if (!subs?.length) continue

      for (const sub of subs) {
        try {
          await sendEmptyPush(sub.endpoint)
          sent++
        } catch (err: unknown) {
          errors++
          const msg = err instanceof Error ? err.message : String(err)
          console.error('Push failed:', msg)
          if (msg.includes('410') || msg.includes('404')) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }

    return Response.json({ sent, errors, time: currentTime, day: currentDay })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
})
