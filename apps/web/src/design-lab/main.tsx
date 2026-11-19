import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './reset.css'
import { DesignLabApp } from './DesignLabApp'

createRoot(document.getElementById('design-lab-root')!).render(
  <StrictMode>
    <DesignLabApp />
  </StrictMode>,
)
