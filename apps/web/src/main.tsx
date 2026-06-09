import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/providers/AppProviders'
import '@/index.css'

// main.tsx is FROZEN after P0 (M2 file-ownership table): it imports AppProviders
// and the stylesheet, nothing else. Provider bodies live in their own files; the
// only sanctioned future addition is the single-line Sentry init in P8.
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
)
