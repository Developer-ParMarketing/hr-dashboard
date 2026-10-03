// App routes. Nav modules: modules/registry.ts. API base URL: api client files + Vite env.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext.tsx'
import { ConfirmProvider } from './components/ConfirmProvider.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import { ProtectedRoute } from './auth/ProtectedRoute.tsx'
import { AdminRoute } from './auth/AdminRoute.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx'
import { ActivateAccountPage } from './pages/ActivateAccountPage.tsx'
import { ChangePasswordPage } from './pages/ChangePasswordPage.tsx'
import { AdminPage } from './pages/AdminPage.tsx'
import { SalaryPage } from './pages/SalaryPage.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { PoliciesPage } from './pages/PoliciesPage.tsx'
import { SettingsPage } from './pages/SettingsPage.tsx'
import { ReportsPage } from './pages/ReportsPage.tsx'
import { FeatureModulePage } from './pages/FeatureModulePage.tsx'
import { FEATURE_MODULE_ROUTES } from './constants/moduleRoutes.ts'
import { AttendancePage } from './pages/AttendancePage.tsx'
import { AttendanceDetailPage } from './pages/AttendanceDetailPage.tsx'
import { HolidayListPage } from './pages/HolidayListPage.tsx'
import { PerformanceAppraisalPage } from './pages/PerformanceAppraisalPage.tsx'
import { PerformanceEmployeeAppraisalPage } from './pages/PerformanceEmployeeAppraisalPage.tsx'
import { GoalSheetPage } from './pages/GoalSheetPage.tsx'
import { GoalSheetEmployeePage } from './pages/GoalSheetEmployeePage.tsx'
import { LeaveRequestPage } from './pages/LeaveRequestPage.tsx'
import { InOutRequestPage } from './pages/InOutRequestPage.tsx'
import { ReimbursementPage } from './pages/ReimbursementPage.tsx'
import { OfferLetterPage } from './pages/OfferLetterPage.tsx'
import { RelievingLetterPage } from './pages/RelievingLetterPage.tsx'
import { DocumentsPage } from './pages/DocumentsPage.tsx'
import { EmployeeDocumentsViewPage } from './pages/EmployeeDocumentsViewPage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ConfirmProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/activate" element={<ActivateAccountPage />} />
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance"
            element={
              <ProtectedRoute>
                <AttendancePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/attendance-detail"
            element={
              <ProtectedRoute>
                <AttendanceDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/policies"
            element={
              <ProtectedRoute>
                <PoliciesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/holidays"
            element={
              <ProtectedRoute>
                <HolidayListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/performance"
            element={
              <ProtectedRoute>
                <PerformanceAppraisalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/performance/employee/:employeeId"
            element={
              <ProtectedRoute>
                <PerformanceEmployeeAppraisalPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/goal-sheet"
            element={
              <ProtectedRoute>
                <GoalSheetPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/goal-sheet/employee/:employeeId"
            element={
              <ProtectedRoute>
                <GoalSheetEmployeePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports/:tab"
            element={
              <ProtectedRoute>
                <ReportsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/leave-request"
            element={
              <ProtectedRoute>
                <LeaveRequestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/in-out-request"
            element={
              <ProtectedRoute>
                <InOutRequestPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reimbursement"
            element={
              <ProtectedRoute>
                <ReimbursementPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/offer-letter"
            element={
              <ProtectedRoute>
                <OfferLetterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/relieving-letter"
            element={
              <ProtectedRoute>
                <RelievingLetterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <DocumentsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents/employee/:employeeId"
            element={
              <ProtectedRoute>
                <EmployeeDocumentsViewPage />
              </ProtectedRoute>
            }
          />
          {FEATURE_MODULE_ROUTES.filter(
            ({ path }) =>
              path !== '/performance' &&
              path !== '/goal-sheet' &&
              path !== '/leave-request' &&
              path !== '/in-out-request' &&
              path !== '/reimbursement' &&
              path !== '/documents',
          ).map(({ path, moduleId }) => (
            <Route
              key={path}
              path={path}
              element={
                <ProtectedRoute>
                  <FeatureModulePage moduleId={moduleId} />
                </ProtectedRoute>
              }
            />
          ))}
          <Route
            path="/salary"
            element={
              <ProtectedRoute>
                <SalaryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ToastProvider>
        </ConfirmProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
