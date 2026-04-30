import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Onboarding from './pages/Onboarding'
import Billing from './pages/Billing'
import AdminBilling from './pages/AdminBilling'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import FollowUps from './pages/FollowUps'
import Orders from './pages/Orders'
import Admin from './pages/Admin'
import Products from './pages/Products'
import Inventory from './pages/Inventory'
import Approvals from './pages/Approvals'
import Repricer from './pages/Repricer'
import TimeClock from './pages/TimeClock'
import Support from './pages/Support'
import UpcScanner from './pages/UpcScanner'
import Ungate from './pages/Ungate'
import Profile from './pages/Profile'
import Wholesale from './pages/Wholesale'
import AuditLog from './pages/AuditLog'
import ShipToAmazon from './pages/ShipToAmazon'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import Waitlist from './pages/Waitlist'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/terms"             element={<Terms />} />
        <Route path="/privacy"           element={<Privacy />} />
        <Route path="/waitlist"          element={<Waitlist />} />
        <Route path="/login"             element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register"          element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password"   element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password"    element={<ResetPassword />} />
        <Route path="/verify-email"      element={<VerifyEmail />} />
        <Route path="/onboarding/amazon" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
        <Route path="/*"                 element={<PrivateRoute />} />
      </Routes>
    </AuthProvider>
  )
}

function PrivateRoute() {
  const { isAuthenticated, isAdmin, isSuperAdmin, user, checking, subscriptionExpired } = useAuth()
  const location = useLocation()

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // Paywall gate: redirect to /billing when subscription expired (non-superadmin)
  if (subscriptionExpired && !isSuperAdmin && location.pathname !== '/billing') {
    return <Navigate to="/billing" replace />
  }

  // Check page-level permission for non-admins
  const canAccessPage = (permKey) => {
    if (isAdmin) return true
    if (!user?.page_permissions) return true   // no restriction
    return user.page_permissions.split(',').map(s => s.trim()).includes(permKey)
  }
  const guard = (permKey, el) => canAccessPage(permKey) ? el : <Navigate to="/" replace />

  return (
    <Layout>
      <Routes>
        <Route path="/"            element={guard('dashboard',   <Dashboard />)} />
        <Route path="/accounts"    element={guard('accounts',    <Accounts />)} />
        <Route path="/follow-ups"  element={guard('follow_ups',  <FollowUps />)} />
        <Route path="/orders"      element={guard('orders',      <Orders />)} />
        <Route path="/wholesale"   element={guard('wholesale',   <Wholesale />)} />
        <Route path="/sourcing"    element={guard('sourcing',    <Products />)} />
        <Route path="/inventory"   element={guard('inventory',   <Inventory />)} />
        <Route path="/products"    element={<Navigate to="/sourcing" replace />} />
        <Route path="/timeclock"   element={guard('timeclock',   <TimeClock />)} />
        <Route path="/support"     element={guard('support',     <Support />)} />
        <Route path="/upc-scanner" element={guard('upc_scanner', <UpcScanner />)} />
        <Route path="/ungate"      element={guard('ungate',      <Ungate />)} />
        <Route path="/ship-to-amazon" element={guard('ship_to_amazon', <ShipToAmazon />)} />
        <Route path="/billing"        element={<Billing />} />
        <Route path="/approvals"      element={isAdmin ? <Approvals />    : <Navigate to="/" replace />} />
        <Route path="/repricer"       element={isAdmin ? <Repricer />     : <Navigate to="/" replace />} />
        <Route path="/admin"          element={isAdmin ? <Admin />        : <Navigate to="/" replace />} />
        <Route path="/admin-billing"  element={isSuperAdmin ? <AdminBilling /> : <Navigate to="/" replace />} />
        <Route path="/audit-log"      element={isSuperAdmin ? <AuditLog />     : <Navigate to="/" replace />} />
        <Route path="/profile"        element={<Profile />} />
        <Route path="*"               element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function PublicRoute({ children }) {
  const { isAuthenticated, checking } = useAuth()
  if (checking) return null
  if (isAuthenticated) return <Navigate to="/" replace />
  return children
}

function OnboardingRoute({ children }) {
  const { isAuthenticated, checking } = useAuth()
  if (checking) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}
