import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { FinanceDbProvider } from './context/FinanceDbProvider'
import { LockGate } from './components/LockGate'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <LockGate>
        <FinanceDbProvider>
          <App />
        </FinanceDbProvider>
      </LockGate>
    </HashRouter>
  </StrictMode>,
)
