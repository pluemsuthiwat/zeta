import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles.css'
import { applyTheme, storedTheme } from './theme.js'
import AppShell from './components/AppShell.jsx'
import { ToastProvider } from './components/Toast.jsx'
import ControllersPage from './pages/ControllersPage.jsx'
import ControllerDetailPage from './pages/ControllerDetailPage.jsx'

applyTheme(storedTheme()) // before first paint: no light flash

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
      <AppShell>
        <Routes>
          <Route path="/" element={<ControllersPage />} />
          <Route path="/controllers/:controllerId" element={<ControllerDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>
)
