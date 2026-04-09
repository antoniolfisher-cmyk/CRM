import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/*" element={<PrivateRoute />} />
      </Routes>
    </AuthProvider>
  )
}

function PrivateRoute() {
  const { isAuthenticated, isAdmin, checking } = useAuth()
  const location = useLocation()

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/sourcing" element={<Products />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/products" element={<Navigate to="/sourcing" replace />} />
        <Route path="/timeclock" element={<TimeClock />} />
        <Route
          path="/approvals"
          element={isAdmin ? <Approvals /> : <Navigate to="/" replace />}
        />
        <Route
          path="/repricer"
          element={isAdmin ? <Repricer /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin"
          element={isAdmin ? <Admin /> : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
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
