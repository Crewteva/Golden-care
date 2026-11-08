// Every date and time is shown on the clinic's clock (Cairo), whatever the device's time zone.
const TZ = 'Africa/Cairo'

export function fmtDateTime(value, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: TZ }).format(new Date(value))
}

export function fmtDate(value, locale) {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: TZ }).format(new Date(value))
}

export function fmtLongDate(value, locale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }).format(
    value ? new Date(value) : new Date(),
  )
}

export function fmtDay(value, locale) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: TZ }).format(new Date(value))
}

const UNITS = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

export function fmtRelative(value, locale) {
  if (!value) return ''
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(Math.round(seconds), 'second')
}

export function fmtNumber(value, locale) {
  return new Intl.NumberFormat(locale).format(value ?? 0)
}

// "+201001110001" → "0100 111 0001" (Egyptian local format)
export function fmtPhone(phone) {
  if (!phone) return ''
  if (!/^\+201\d{9}$/.test(phone)) return phone
  const local = `0${phone.slice(3)}`
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}

export function initials(name) {
  if (!name) return '؟'
  const parts = name.replace(/^(د\.|dr\.?)\s*/i, '').trim().split(/\s+/)
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

// Value for <input type="datetime-local"> in the browser's time zone.
export function toLocalInput(date) {
  const d = new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
