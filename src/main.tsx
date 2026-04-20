import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { FinanceDbProvider } from './context/FinanceDbProvider'
import { normalizeHashOnlySpaUrl } from './lib/urls/hashRouterUrl'
import './index.css'
import App from './App.tsx'

normalizeHashOnlySpaUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <FinanceDbProvider>
        <App />
      </FinanceDbProvider>
    </HashRouter>
  </StrictMode>,
)
