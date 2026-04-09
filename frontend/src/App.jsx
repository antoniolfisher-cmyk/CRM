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
        <Route path="/inventory" element={<Products />} />
        <Route path="/products" element={<Navigate to="/inventory" replace />} />
        <Route path="/timeclock" element={<TimeClock />} />
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
