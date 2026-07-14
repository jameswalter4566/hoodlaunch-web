import { useEffect } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import AuthButton from './components/AuthButton.jsx'
import Landing from './pages/Landing.jsx'
import Pulse from './pages/Pulse.jsx'
import Token from './pages/Token.jsx'
import Launch from './pages/Launch.jsx'
import Profile from './pages/Profile.jsx'
import Leaderboard from './pages/Leaderboard.jsx'

function Sidebar() {
  return (
    <aside className="sb">
      <div className="sb-top">
        <NavLink className="sb-brand" to="/"><img src="/logo.png" alt="" /><span>bullish</span></NavLink>
      </div>
      <nav className="sb-nav">
        <NavLink to="/pulse" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h4l3-8 4 16 3-8h6" /></svg>
          <span>Pulse</span>
        </NavLink>
        <NavLink to="/leaderboard" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 21V10M16 21V6M12 21V14" /></svg>
          <span>Leaderboard</span>
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c2-4 6-6 8-6s6 2 8 6" /></svg>
          <span>Profile</span>
        </NavLink>
        <NavLink to="/launch" className="sb-launch">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2c4 3 6 7 6 11l-3 3H9l-3-3c0-4 2-8 6-11z" /><circle cx="12" cy="9" r="2" /><path d="M8 17l-2 5 4-2M16 17l2 5-4-2" /></svg>
          <span>Launch</span>
        </NavLink>
      </nav>
    </aside>
  )
}

export default function App() {
  const auth = useAuth()
  const loc = useLocation()
  const isLanding = loc.pathname === '/'

  // The glass-panel + sky-video CSS is scoped to body.app-sky (landing is body.ld),
  // exactly like the original static pages — so drive the body class by route.
  useEffect(() => {
    document.body.className = isLanding ? 'ld' : 'app-sky'
    // nudge the background video to play (autoplay can stall behind content)
    const v = document.querySelector('.app-sky-bg')
    if (v) { v.muted = true; v.play?.().catch(() => {}) }
  }, [isLanding])

  if (isLanding) return <Landing auth={auth} />

  return (
    <>
      <video className="app-sky-bg" src="/sky.mp4" autoPlay muted loop playsInline />
      <Sidebar />
      <AuthButton auth={auth} />
      <Routes>
        <Route path="/pulse" element={<Pulse />} />
        <Route path="/coin/:address" element={<Token auth={auth} />} />
        <Route path="/launch" element={<Launch auth={auth} />} />
        <Route path="/profile" element={<Profile auth={auth} />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="*" element={<Pulse />} />
      </Routes>
    </>
  )
}
