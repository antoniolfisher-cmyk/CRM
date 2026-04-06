import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import FollowUps from './pages/FollowUps'
import Orders from './pages/Orders'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/orders" element={<Orders />} />
      </Routes>
    </Layout>
  )
}
