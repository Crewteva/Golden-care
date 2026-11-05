// Mirrors the backend rules (app/core/security.py) so people see problems while typing.
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop',
  'qwerty123', '11111111', '00000000', 'iloveyou', 'goldencare', 'golden123', 'admin123', 'welcome1',
])

export function passwordChecks(password, kind = 'staff') {
  const min = kind === 'staff' ? 10 : 8
  return {
    min,
    length: password.length >= min,
    mix: /\p{L}/u.test(password) && /[\d\W_]/u.test(password),
    common: password.length > 0 && !COMMON.has(password.toLowerCase()),
  }
}

export function passwordScore(password, kind = 'staff') {
  if (!password) return 0
  const c = passwordChecks(password, kind)
  let score = 1
  if (c.length) score++
  if (c.mix && c.common) score++
  if (password.length >= c.min + 4 && /[^\p{L}\d]/u.test(password)) score++
  return Math.min(score, 4)
}

export function passwordProblem(password, kind = 'staff') {
  const c = passwordChecks(password, kind)
  if (!c.length) return 'too_short'
  if (!c.common) return 'too_common'
  if (!c.mix) return 'needs_mix'
  return null
}
