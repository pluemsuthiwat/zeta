import { useEffect, useState } from 'react'

const KEY = 'zeta-theme'

export function storedTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Applies the theme to the page and to native parts (dialogs, Windows title-bar buttons). */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  window.zeta?.window?.setTheme(theme)
}

export function useTheme() {
  const [theme, setTheme] = useState(storedTheme)
  useEffect(() => {
    applyTheme(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* per-device preference only */
    }
  }, [theme])
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))]
}
