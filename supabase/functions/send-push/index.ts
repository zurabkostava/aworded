// Supabase Edge Function: send-push
// Called by pg_cron every minute to check and send scheduled notifications

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Web Push crypto utilities
async function sendWebPush(subscription: { endpoint: string; p256dh: string; auth: string }, payload: string) {
  // Use web-push compatible approach
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'TTL': '86400',
    },
    body: payload,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Push failed: ${response.status} ${text}`)
  }

  return response
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const now = new Date()
    const currentDay = now.getDay() // 0=Sun
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    // Get all enabled notification schedules for current time and day
    const { data: schedules, error: schedError } = await supabase
      .from('notification_schedules')
      .select('*')
      .eq('enabled', true)
      .eq('time', currentTime)
      .contains('days', [currentDay])

    if (schedError) {
      return new Response(JSON.stringify({ error: schedError.message }), { status: 500 })
    }

    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ message: 'No notifications to send', time: currentTime, day: currentDay }))
    }

    let sent = 0
    let errors = 0

    for (const schedule of schedules) {
      // Get random card for this notification
      let cardTitle = 'AWorded'
      let cardBody = 'დროა ისწავლო!'

      try {
        const params: any = {
          dict_id_input: schedule.dictionary_id || null,
          tag_names_input: schedule.tags?.length > 0 ? schedule.tags : null,
          progress_min_input: null,
          progress_max_input: null,
        }

        if (schedule.progress_range) {
          const parts = schedule.progress_range.split('-')
          params.progress_min_input = parseInt(parts[0])
          params.progress_max_input = parseInt(parts[1])
        }

        const { data: card } = await supabase.rpc('get_random_card', params).single()

        if (card) {
          cardTitle = card.word || 'AWorded'
          cardBody = (card.main_translations || []).join(', ')
        }
      } catch {
        // Use default message if card fetch fails
      }

      // Get all push subscriptions for this user
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', schedule.user_id)

      if (!subs || subs.length === 0) continue

      const payload = JSON.stringify({
        title: cardTitle,
        body: cardBody,
        tag: `aworded-${schedule.id}`,
      })

      for (const sub of subs) {
        try {
          await sendWebPush(
            { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload
          )
          sent++
        } catch (err) {
          errors++
          console.error(`Push error for ${sub.endpoint}:`, err.message)
          // Remove invalid subscriptions
          if (err.message.includes('410') || err.message.includes('404')) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }

    return new Response(JSON.stringify({ sent, errors, time: currentTime, day: currentDay }))
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
})
