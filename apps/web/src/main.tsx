import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/ThemeProvider.tsx'
import { GalleryPage } from './pages/GalleryPage.tsx'
import { SessionProvider, SessionGate } from './hooks/SessionContext'
import { LoginPage, PasswordPage } from './pages/AccountPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { AdminPage } from './pages/AdminPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <SessionProvider><Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/password" element={<SessionGate><PasswordPage /></SessionGate>} />
          <Route path="/" element={<SessionGate><App /></SessionGate>} />
          <Route path="/gallery" element={<SessionGate><GalleryPage /></SessionGate>} />
          <Route path="/channels" element={<SessionGate><ChannelsPage /></SessionGate>} />
          <Route path="/admin" element={<SessionGate admin><AdminPage /></SessionGate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
