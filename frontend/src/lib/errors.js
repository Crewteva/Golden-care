import { strings } from '../i18n/strings'

// Turns an ApiError into a sentence in the current language.
export function errorText(error, t) {
  const code = error?.code
  if (code && strings[`err.${code}`]) return t(`err.${code}`)
  return t('err.generic')
}

// Field message: "field.<name>.<code>" first, then "field.<code>".
export function fieldText(field, code, t) {
  if (!code) return undefined
  if (strings[`field.${field}.${code}`]) return t(`field.${field}.${code}`)
  if (strings[`field.${code}`]) return t(`field.${code}`)
  return t('field.invalid')
}

export function fieldErrors(error, t) {
  const out = {}
  for (const [field, code] of Object.entries(error?.fields || {})) out[field] = fieldText(field, code, t)
  return out
}
