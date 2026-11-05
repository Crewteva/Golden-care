import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { strings } from './strings'

const I18nCtx = createContext(null)
const STORAGE_KEY = 'gc.lang'

function initialLang() {
  // A shared link can pick the language: ?lang=en or ?lang=ar
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl === 'ar' || fromUrl === 'en') return fromUrl
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ar' || saved === 'en') return saved
  } catch {
    /* private mode */
  }
  return 'ar'
}

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(initialLang)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      const entry = strings[key]
      let text = entry ? entry[lang] : key
      if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v)
      return text
    },
    [lang],
  )
  const tx = useCallback((ar, en) => (lang === 'ar' ? ar : en), [lang])
  // Picks name_ar / name_en (or any base) from an API object, falling back to Arabic.
  const pick = useCallback(
    (obj, base = 'name') => (obj ? obj[`${base}_${lang}`] || obj[`${base}_ar`] || obj[`${base}_en`] || '' : ''),
    [lang],
  )

  const value = useMemo(
    () => ({
      lang,
      setLang,
      t,
      tx,
      pick,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      locale: lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    }),
    [lang, t, tx, pick],
  )
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export const useI18n = () => useContext(I18nCtx)
