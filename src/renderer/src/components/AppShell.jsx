import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Moon, Sun } from 'lucide-react'
import logo from '../assets/logo.svg'
import { useTheme } from '../theme.js'
import { cx } from './ui.jsx'
import SourceInterfacePicker from './SourceInterfacePicker.jsx'
import AboutDialog from './AboutDialog.jsx'
import UpdateBanner from './UpdateBanner.jsx'

const isMac = window.zeta.platform === 'darwin'

export default function AppShell({ children }) {
  const [theme, toggleTheme] = useTheme()
  const [aboutOpen, setAboutOpen] = useState(false)
  return (
    <div className="flex h-full flex-col">
      {/* Doubles as the window title bar: drag anywhere, leave room for the window buttons. */}
      <header
        className={cx(
          'drag relative z-40 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg/75 backdrop-blur-xl',
          isMac ? 'pl-[84px] pr-4' : 'pl-4 pr-[150px]'
        )}
      >
        <Link to="/" className="no-drag flex items-center gap-2.5">
          <img src={logo} alt="" className="size-6 rounded-[7px]" />
          <span className="text-[15px] font-semibold tracking-tight text-fg">Zeta</span>
          <span className="mono rounded-md px-1.5 py-0.5 text-[11px] text-subtle ring-1 ring-inset ring-line">v{__APP_VERSION__}</span>
        </Link>
        <span className="h-4 w-px bg-line-strong" />
        <span className="text-[13px] text-subtle">Aruba AP Provisioning</span>
        <div className="ml-auto" />
        <SourceInterfacePicker />
        <button
          onClick={toggleTheme}
          className="no-drag grid size-8 place-items-center rounded-lg text-subtle transition-colors hover:bg-hover hover:text-fg"
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button
          onClick={() => setAboutOpen(true)}
          className="no-drag grid size-8 place-items-center rounded-lg text-subtle transition-colors hover:bg-hover hover:text-fg"
          title="About Zeta"
          aria-label="About Zeta"
        >
          <Info className="size-4" />
        </button>
      </header>
      <UpdateBanner />
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  )
}
