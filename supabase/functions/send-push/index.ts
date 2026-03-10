// Supabase Edge Function: send-push
// Uses native fetch + VAPID JWT for Web Push

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Base64URL encode/decode helpers
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

// Create VAPID JWT
async function createVapidJwt(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: 'mailto:zurabkostava1@gmail.com'
  }

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const unsigned = `${headerB64}.${payloadB64}`

  // Import the VAPID private key
  const privateKeyBytes = base64UrlDecode(VAPID_PRIVATE_KEY)
  // Build JWK for P-256
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: VAPID_PRIVATE_KEY,
    x: VAPID_PUBLIC_KEY.substring(0, 43),
    y: VAPID_PUBLIC_KEY.substring(43),
  }

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  )

  // Convert from DER to raw r||s format if needed
  const sig = new Uint8Array(signature)
  let r: Uint8Array, s: Uint8Array

  if (sig.length === 64) {
    // Already raw format
    r = sig.slice(0, 32)
    s = sig.slice(32)
  } else {
    // DER format - extract r and s
    r = sig.slice(0, 32)
    s = sig.slice(32, 64)
  }

  const rawSig = new Uint8Array(64)
  rawSig.set(r)
  rawSig.set(s, 32)

  return `${unsigned}.${base64UrlEncode(rawSig)}`
}

async function sendPushNotification(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: string
): Promise<boolean> {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`

  const jwt = await createVapidJwt(audience)
  const vapidKeyBytes = base64UrlDecode(VAPID_PUBLIC_KEY)

  const response = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      'Content-Length': '0',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }

  return true
}

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Get current time in Tbilisi timezone (UTC+4)
    const now = new Date()
    const tbilisi = new Date(now.getTime() + 4 * 60 * 60 * 1000)
    const currentDay = tbilisi.getUTCDay()
    const currentTime = `${String(tbilisi.getUTCHours()).padStart(2, '0')}:${String(tbilisi.getUTCMinutes()).padStart(2, '0')}`

    // Get matching schedules
    const { data: schedules, error } = await supabase
      .from('notification_schedules')
      .select('*')
      .eq('enabled', true)
      .eq('time', currentTime)
      .contains('days', [currentDay])

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    if (!schedules?.length) {
      return Response.json({ message: 'No notifications', time: currentTime, day: currentDay })
    }

    let sent = 0, errors = 0

    for (const schedule of schedules) {
      // Get random card
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

      // Get push subscriptions
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', schedule.user_id)

      if (!subs?.length) continue

      for (const sub of subs) {
        try {
          await sendPushNotification(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            JSON.stringify({ title, body, tag: `aworded-${schedule.id}` })
          )
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
