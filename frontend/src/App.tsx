import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useNativeOAuthCallback } from "./hooks/useNativeOAuthCallback";
import { useAndroidBackButton } from "./hooks/useAndroidBackButton";
import { useCallAlertRegistration } from "./hooks/useCallAlertRegistration";
import { useCallLogSync } from "./hooks/useCallLogSync";
import { ThemeProvider } from "./lib/theme";
import { TooltipProvider } from "./components/ui/tooltip";
import Layout from "./components/layout/Layout";
import { Spinner } from "./components/ui/Spinner";
import LoginPage from "./pages/Login";
import GoogleFormsCallbackPage from "./pages/GoogleFormsCallback";
import SignUpPage from "./pages/SignUp";
import WelcomePage from "./pages/Welcome";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import ChangePasswordPage from "./pages/ChangePassword";
import MfaChallengePage from "./pages/MfaChallenge";
import MfaSetupPage from "./pages/MfaSetup";
import MfaResetRequestPage from "./pages/MfaResetRequest";
import MfaResetConfirmPage from "./pages/MfaResetConfirm";
import VerifyEmailPage from "./pages/VerifyEmail";
import OAuthCallbackPage from "./pages/OAuthCallback";
import RegisterCompletePage from "./pages/RegisterComplete";
import DashboardPage from "./pages/Dashboard";
import LeadsPage from "./pages/Leads";
import LeadDetailPage from "./pages/LeadDetail";
import ReportsPage from "./pages/Reports";
import PaymentsPage from "./pages/Payments";
import PaymentDetailPage from "./pages/PaymentDetail";
import RegisterPage from "./pages/Register";
import NewRegistrationPage from "./pages/RegisterNew";
import InvoicesPage from "./pages/Invoices";
import CoursesPage from "./pages/Courses";
import InvoiceFormPage from "./pages/InvoiceForm";
import CallLogPage from "./pages/CallLog";
import UsersPage from "./pages/Users";
import NotificationsPage from "./pages/Notifications";
import IntegrationsPage from "./pages/Integrations";
import NurturingPage from "./pages/Nurturing";
import TemplatesPage from "./pages/Templates";
import BillingPage from "./pages/Billing";
import AdministrationPage from "./pages/Administration";
import ImpersonationPage from "./pages/Impersonation";
import PrivacyPage from "./pages/Privacy";
import AuthorizeMandatePage from "./pages/AuthorizeMandate";
import TermsPage from "./pages/Terms";
import { WorkspaceRoute } from "./components/routing/WorkspaceRoute";
import { ModuleListRoute } from "./components/module/ModuleListRoute";
import { ModuleDetailRoute } from "./components/module/ModuleDetailRoute";
import { useWorkspace } from "./hooks/useWorkspace";
import { isNative } from "./lib/platform";
import { hasAuthenticatedBefore } from "./lib/firstRun";

// /reports and /payments are shared sidebar labels across both workspace types but point at
// completely different implementations — EdTech's bespoke pages vs. the generic manufacturing
// module framework — so the route element itself branches, rather than duplicating the path.
function ReportsRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleListRoute moduleKey="reports" /> : <ReportsPage />;
}
function ReportDetailRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleDetailRoute moduleKey="reports" /> : <Navigate to="/reports" replace />;
}
function PaymentsRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleListRoute moduleKey="payments" /> : <PaymentsPage />;
}
function PaymentsDetailRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleDetailRoute moduleKey="payments" /> : <PaymentDetailPage />;
}
// Same shared-path branching as above — Manufacturing's "leads" is a different model
// (MfgLead, via the generic module framework) from EdTech's Lead, so /leads needs the same
// per-workspace split even though it isn't in MFG_MODULE_ROUTES (which only lists the modules
// with no EdTech path collision).
function LeadsRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleListRoute moduleKey="leads" /> : <LeadsPage />;
}
function LeadDetailRoute() {
  return useWorkspace() === "MANUFACTURING" ? <ModuleDetailRoute moduleKey="leads" /> : <LeadDetailPage />;
}

// Manufacturing-only modules: registry key -> URL path segment (see modulePaths.ts — kept in
// sync there for cross-module navigation; this list just drives route registration).
const MFG_MODULE_ROUTES: { path: string; moduleKey: string }[] = [
  { path: "accounts", moduleKey: "accounts" },
  { path: "contacts", moduleKey: "contacts" },
  { path: "activities", moduleKey: "activities" },
  { path: "opportunities", moduleKey: "opps" },
  { path: "rfqs", moduleKey: "rfqs" },
  { path: "site-visits", moduleKey: "visits" },
  { path: "demos", moduleKey: "demos" },
  { path: "products", moduleKey: "products" },
  { path: "costing", moduleKey: "costing" },
  { path: "quotations", moduleKey: "quotes" },
  { path: "approvals", moduleKey: "approvals" },
  { path: "purchase-orders", moduleKey: "pos" },
  { path: "sales-orders", moduleKey: "sorders" },
  { path: "dispatch", moduleKey: "dispatch" },
  { path: "installed-assets", moduleKey: "assets" },
  { path: "amc", moduleKey: "amc" },
  { path: "dealers", moduleKey: "dealers" },
  { path: "tenders", moduleKey: "tenders" },
  { path: "service-tickets", moduleKey: "service" },
];

function PrivateRoute({
  children,
  allowPasswordChange = false,
}: {
  children: React.ReactNode;
  allowPasswordChange?: boolean;
}) {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  // The Android app's very first launch lands on the welcome carousel; every launch after the
  // first successful sign-in lands on login.
  if (!user)
    return <Navigate to={isNative() && !hasAuthenticatedBefore() ? "/welcome" : "/login"} replace />;
  // Force the first-login password change before any protected route is reachable.
  if (user.mustChangePassword && !allowPasswordChange)
    return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();
  useNativeOAuthCallback();
  useAndroidBackButton();
  useCallAlertRegistration();
  useCallLogSync();
  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        path="/signup"
        element={user ? <Navigate to="/" replace /> : <SignUpPage />}
      />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route
        path="/change-password"
        element={
          <PrivateRoute allowPasswordChange>
            <ChangePasswordPage />
          </PrivateRoute>
        }
      />
      {/* Both unguarded: a login-time MFA detour has no session yet to gate on
          (mfa-challenge always; mfa-setup only when org-enforced and unenrolled).
          mfa-setup also doubles as the self-service enroll flow for an already
          signed-in user navigating here from the Account dialog. */}
      <Route path="/mfa-challenge" element={<MfaChallengePage />} />
      <Route path="/mfa-setup" element={<MfaSetupPage />} />
      <Route path="/mfa-reset-request" element={<MfaResetRequestPage />} />
      <Route path="/mfa-reset" element={<MfaResetConfirmPage />} />
      <Route path="/authorize-mandate" element={<AuthorizeMandatePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route
        path="/integrations/google-forms/callback"
        element={
          <PrivateRoute>
            <GoogleFormsCallbackPage />
          </PrivateRoute>
        }
      />
      <Route
        path="/signup/complete"
        element={
          <PrivateRoute>
            <RegisterCompletePage />
          </PrivateRoute>
        }
      />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="leads" element={<LeadsRoute />} />
        <Route path="leads/:id" element={<LeadDetailRoute />} />
        <Route path="reports" element={<ReportsRoute />} />
        <Route path="reports/:id" element={<ReportDetailRoute />} />
        <Route path="payments" element={<PaymentsRoute />} />
        <Route path="payments/:id" element={<PaymentsDetailRoute />} />
        {MFG_MODULE_ROUTES.map(({ path, moduleKey }) => (
          <React.Fragment key={path}>
            <Route
              path={path}
              element={
                <WorkspaceRoute allow="MANUFACTURING">
                  <ModuleListRoute moduleKey={moduleKey} />
                </WorkspaceRoute>
              }
            />
            <Route
              path={`${path}/:id`}
              element={
                <WorkspaceRoute allow="MANUFACTURING">
                  <ModuleDetailRoute moduleKey={moduleKey} />
                </WorkspaceRoute>
              }
            />
          </React.Fragment>
        ))}
        <Route path="register" element={<RegisterPage />} />
        <Route path="register/new" element={<NewRegistrationPage />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<InvoiceFormPage />} />
        <Route path="invoices/:id/edit" element={<InvoiceFormPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="calls" element={<CallLogPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="form-responses" element={<Navigate to="/leads" replace />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="nurturing" element={<NurturingPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="administration" element={<AdministrationPage />} />
        <Route path="impersonation" element={<ImpersonationPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            {/* top-center (not top-right) with a safe-area offset — on the Capacitor
                Android WebView, top-right let the status bar clip/cover the toast and,
                on narrow phones, pushed part of it past the right edge (see SCRUM-24). */}
            <Toaster
              richColors
              position="top-center"
              offset={{ top: "max(1rem, env(safe-area-inset-top))" }}
            />
          </BrowserRouter>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
