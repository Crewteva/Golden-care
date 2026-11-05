import { useCallback, useEffect, useRef, useState } from 'react'

// Loads data for a page and exposes { data, error, loading, reload, setData }.
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const latest = useRef(0)

  const run = useCallback(async () => {
    const call = ++latest.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loader()
      if (call === latest.current) setState({ data, error: null, loading: false })
    } catch (error) {
      if (call === latest.current) setState((s) => ({ ...s, error, loading: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  const setData = useCallback((data) => setState((s) => ({ ...s, data })), [])
  return { ...state, reload: run, setData }
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
