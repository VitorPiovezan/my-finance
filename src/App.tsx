import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AccountsPage } from './pages/AccountsPage'
import { AgendaPage } from './pages/AgendaPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { CategoriesAnalyticsPage } from './pages/CategoriesAnalyticsPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategorizePage } from './pages/CategorizePage'
import { ConfigIaPage } from './pages/ConfigIaPage'
import { DashboardPage } from './pages/DashboardPage'
import { ImportacoesPage } from './pages/ImportacoesPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { LancamentosPage } from './pages/LancamentosPage'
import { SyncPage } from './pages/SyncPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="analise/:scope/:ym" element={<AnalysisPage />} />
        <Route path="contas" element={<AccountsPage />} />
        <Route path="lancamentos" element={<LancamentosPage />} />
        <Route path="categorias" element={<CategoriesPage />} />
        <Route path="categorizar" element={<CategorizePage />} />
        <Route path="por-categoria" element={<CategoriesAnalyticsPage />} />
        <Route path="agenda" element={<AgendaPage />} />
        <Route path="investimentos" element={<InvestmentsPage />} />
        <Route path="sincronizar" element={<SyncPage />} />
        <Route path="importacoes" element={<ImportacoesPage />} />
        <Route path="config-ia" element={<ConfigIaPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
