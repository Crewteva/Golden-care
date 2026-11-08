// Appointment times are always shown on the clinic's clock (Cairo), whatever the viewer's own time zone.
export const CLINIC_TZ = 'Africa/Cairo'

const keyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const partsFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** YYYY-MM-DD of a moment on the clinic's calendar (default: now). */
export const dayKey = (moment = new Date()) => keyFormat.format(new Date(moment))

export function addDays(key, days) {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const weekdayOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay()

/** The Saturday that starts the week containing `key`. */
export const saturdayOf = (key) => addDays(key, -((weekdayOf(key) + 1) % 7))

export function clock(iso, locale) {
  return new Intl.DateTimeFormat(locale, { timeZone: CLINIC_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function dayLabel(key, locale, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(new Date(`${key}T12:00:00Z`))
}

/** Minutes since midnight on the clinic clock. */
export function minuteOfDay(iso) {
  const [h, m] = partsFormat.format(new Date(iso)).split(':').map(Number)
  return h * 60 + m
}

export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000)
