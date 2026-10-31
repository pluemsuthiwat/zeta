import { useEffect, useState } from 'react'
import { api } from '../api.js'

const SKIP_KEY = 'zeta-skipped-update'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000 // the app may stay open (or in the tray) for days
const FIRST_CHECK_MS = 3000 // let the first screen load before going online

function storedSkip() {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}

/**
 * Newest release on GitHub, shared by the banner, the header's update button and About.
 * The banner can be put away ("Later" until the next start, or "Skip this version");
 * the header button stays as long as a newer version exists.
 */
export function useUpdateCheck() {
  const [update, setUpdate] = useState(null)
  const [laterFor, setLaterFor] = useState(null)
  const [skipped, setSkipped] = useState(storedSkip)

  useEffect(() => {
    const check = () => api.app.checkUpdate().then(setUpdate, () => {}) // no internet is normal on a provisioning network
    const first = setTimeout(check, FIRST_CHECK_MS)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [])

  const available = Boolean(update?.available)
  return {
    update,
    setUpdate,
    available,
    bannerVisible: available && laterFor !== update.latest && skipped !== update.latest,
    skipped: available && skipped === update.latest,
    later: () => setLaterFor(update?.latest),
    skip: () => {
      try {
        localStorage.setItem(SKIP_KEY, update.latest)
      } catch {
        /* still hidden until the next start */
      }
      setSkipped(update.latest)
    }
  }
}
