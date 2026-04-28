import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { DriveOAuthImplicitCompletion } from './components/DriveOAuthImplicitCompletion'
import { FirebaseEmailLinkCompletion } from './components/FirebaseEmailLinkCompletion'
import { GoogleAccessGate } from './components/GoogleAccessGate'
import { AccountsPage } from './pages/AccountsPage'
import { AgendaPage } from './pages/AgendaPage'
import { AnalysisPage } from './pages/AnalysisPage'
import { CategoriesPeriodProvider } from './context/CategoriesPeriodContext'
import { CategoriesAnalyticsPage } from './pages/CategoriesAnalyticsPage'
import { CategoriesPage } from './pages/CategoriesPage'
import { CategorizePage } from './pages/CategorizePage'
import { ConfigIaPage } from './pages/ConfigIaPage'
import { DashboardPage } from './pages/DashboardPage'
import { GoogleLoginPage } from './pages/GoogleLoginPage'
import { ImportacoesPage } from './pages/ImportacoesPage'
import { InvestmentsPage } from './pages/InvestmentsPage'
import { LancamentosPage } from './pages/LancamentosPage'
import { OnboardingGooglePage } from './pages/OnboardingGooglePage'
import { SimuladorPjPage } from './pages/SimuladorPjPage'
import { SyncPage } from './pages/SyncPage'

export default function App() {
  return (
    <>
      <FirebaseEmailLinkCompletion />
      <DriveOAuthImplicitCompletion />
      <Routes>
        <Route path="/entrar" element={<GoogleLoginPage />} />
        <Route path="/primeiro-acesso" element={<OnboardingGooglePage />} />
        <Route
          element={
            <GoogleAccessGate>
              <AppShell />
            </GoogleAccessGate>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="analise/:scope/:ym" element={<AnalysisPage />} />
          <Route path="contas" element={<AccountsPage />} />
          <Route path="lancamentos" element={<LancamentosPage />} />
          <Route path="categorias" element={<CategoriesPage />} />
          <Route path="categorizar" element={<CategorizePage />} />
          <Route
            path="por-categoria"
            element={
              <CategoriesPeriodProvider>
                <CategoriesAnalyticsPage />
              </CategoriesPeriodProvider>
            }
          />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="investimentos" element={<InvestmentsPage />} />
          <Route path="sincronizar" element={<SyncPage />} />
          <Route path="importacoes" element={<ImportacoesPage />} />
          <Route path="config-ia" element={<ConfigIaPage />} />
          <Route path="simulador-pj" element={<SimuladorPjPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
