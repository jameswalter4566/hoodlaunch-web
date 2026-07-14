import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { API } from '../api'

// Home = the full token terminal for the most recently launched coin (the list +
// chart + buy panel show by default). Falls back to Launch if nothing's launched.
export default function Home() {
  const [to, setTo] = useState(null)

  useEffect(() => {
    let alive = true
    fetch(API + '/api/board').then((r) => r.json()).then((b) => {
      if (!alive) return
      const all = [].concat(b.new, b.graduating, b.graduated)
      if (!all.length) { setTo('/launch'); return }
      all.sort((a, c) => new Date(c.created_at) - new Date(a.created_at))
      setTo('/coin/' + all[0].address)
    }).catch(() => alive && setTo('/launch'))
    return () => { alive = false }
  }, [])

  if (!to) return <div className="main" style={{ padding: 40, color: 'var(--txt3)' }}>Loading…</div>
  return <Navigate to={to} replace />
}
