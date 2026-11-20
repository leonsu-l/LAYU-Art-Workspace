import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App'
import { ThemeProvider } from './components/ThemeProvider'
import { StudioLayout } from './components/StudioHeader'
import { GalleryPage } from './pages/GalleryPage'
import { SessionProvider, SessionGate } from './hooks/SessionContext'
import { LoginPage, PasswordPage } from './pages/AccountPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { AdminPage } from './pages/AdminPage'

const router = createBrowserRouter([{
  element: <SessionProvider><StudioLayout /></SessionProvider>,
  children: [
    { path: '/login', element: <LoginPage /> },
    { path: '/password', element: <SessionGate><PasswordPage /></SessionGate> },
    { path: '/', element: <SessionGate><App /></SessionGate> },
    { path: '/gallery', element: <SessionGate><GalleryPage /></SessionGate> },
    { path: '/channels', element: <SessionGate><ChannelsPage /></SessionGate> },
    { path: '/admin', element: <SessionGate admin><AdminPage /></SessionGate> },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode><ThemeProvider><RouterProvider router={router} /></ThemeProvider></StrictMode>,
)
