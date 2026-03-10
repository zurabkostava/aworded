// Supabase Edge Function: send-push
// Called by pg_cron every minute to send scheduled push notifications

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

webpush.setVapidDetails(
  'mailto:zurabkostava1@gmail.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
)

Deno.serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const now = new Date()
    const currentDay = now.getDay()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    // Get all enabled schedules for current time and day
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
      return new Response(JSON.stringify({ message: 'No notifications', time: currentTime, day: currentDay }))
    }

    let sent = 0
    let errors = 0

    for (const schedule of schedules) {
      // Get random card
      let cardTitle = 'AWorded'
      let cardBody = 'დროა ისწავლო!'

      try {
        const params: Record<string, unknown> = {
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
        // Use default message
      }

      // Get push subscriptions for this user
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
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth }
            },
            payload
          )
          sent++
        } catch (err: unknown) {
          errors++
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`Push error:`, errMsg)
          // Remove invalid/expired subscriptions
          if (errMsg.includes('410') || errMsg.includes('404') || errMsg.includes('expired')) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          }
        }
      }
    }

    return new Response(JSON.stringify({ sent, errors, time: currentTime, day: currentDay }))
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
})
