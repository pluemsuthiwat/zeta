import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cx } from './ui.jsx'

const ToastContext = createContext(() => {})

/** toast({ tone: 'success' | 'error' | 'info', title, message }) */
export function useToast() {
  return useContext(ToastContext)
}

const TONE = {
  success: { icon: CheckCircle2, color: 'text-ok', bar: 'bg-ok', ms: 4000 },
  error: { icon: AlertCircle, color: 'text-bad', bar: 'bg-bad', ms: 7000 },
  info: { icon: Info, color: 'text-info', bar: 'bg-info', ms: 4000 }
}

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const dismiss = useCallback((id) => setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t))), [])
  const remove = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const toast = useCallback((t) => {
    const id = nextId++
    setToasts((list) => [...list.slice(-3), { id, tone: 'info', ...t }]) // at most 4 on screen
    return id
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[360px] flex-col gap-2.5">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} onGone={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast: t, onDismiss, onGone }) {
  const tone = TONE[t.tone] || TONE.info
  const Icon = tone.icon
  const [paused, setPaused] = useState(false)
  const remaining = useRef(tone.ms)
  const startedAt = useRef(Date.now())

  // Auto-dismiss, paused while hovered.
  useEffect(() => {
    if (t.leaving || paused) return
    startedAt.current = Date.now()
    const timer = setTimeout(onDismiss, remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [paused, t.leaving, onDismiss])

  return (
    <div
      role={t.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onAnimationEnd={(e) => t.leaving && e.animationName === 'toast-out' && onGone()}
      className={cx(
        'pointer-events-auto relative overflow-hidden rounded-xl border border-line-strong bg-elev/95 shadow-2xl shadow-black/30 backdrop-blur-xl',
        t.leaving ? 'animate-[toast-out_160ms_ease-in_forwards]' : 'animate-[toast-in_220ms_cubic-bezier(0.2,0.9,0.3,1.2)]'
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon className={cx('mt-0.5 size-[18px] shrink-0', tone.color)} />
        <div className="min-w-0 flex-1">
          {t.title && <div className="text-sm font-medium text-fg">{t.title}</div>}
          {t.message && <div className={cx('break-words text-[13px] leading-relaxed text-muted', t.title && 'mt-0.5')}>{t.message}</div>}
        </div>
        <button
          onClick={onDismiss}
          className="-mr-1 rounded-md p-0.5 text-subtle transition-colors hover:bg-hover hover:text-fg"
          aria-label="Dismiss"
        >
          <X className="size-4" />
        </button>
      </div>
      {/* time left before it closes */}
      <div
        className={cx('absolute bottom-0 left-0 h-0.5 opacity-60', tone.bar)}
        style={{ animation: `toast-timer ${tone.ms}ms linear forwards`, animationPlayState: paused || t.leaving ? 'paused' : 'running' }}
      />
    </div>
  )
}
