import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, EXPLORER, usd, ethUsd, fmtAge, shortAddr } from '../api'
import AdminLaunch from './AdminLaunch.jsx'
import AdminGate from '../components/AdminGate.jsx'

// Private admin dashboard behind the shared PIN gate: a 1:1 launch form and a
// read-only launch monitor. Each launch links to its bundler terminal.
export default function Admin({ auth }) {
  return <AdminGate><AdminInner auth={auth} /></AdminGate>
}

function AdminInner({ auth }) {
  const [rows, setRows] = useState([])
  const [eth, setEth] = useState(0)

  useEffect(() => {
    let alive = true
    ethUsd().then((v) => alive && setEth(v))
    const load = () =>
      fetch(API + '/api/board').then((r) => r.json()).then((b) => {
        if (!alive) return
        const all = [...(b.new || []), ...(b.graduating || []), ...(b.graduated || [])]
        all.sort((a, c) => new Date(c.created_at) - new Date(a.created_at))
        setRows(all)
      }).catch(() => {})
    load(); const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [])

  const totVol = rows.reduce((a, t) => a + (t.volume24hEth || t.volumeTotalEth || 0), 0)
  const totMc = rows.reduce((a, t) => a + (t.marketCapEth || 0), 0)
  const totHolders = rows.reduce((a, t) => a + (t.holders || 0), 0)

  return (
    <div className="main adm">
      <div className="adm-wrap">
        <div className="adm-head">
          <h1>Launch monitor</h1>
          <div className="adm-head-r">
            <Link className="adm-launch" to="/launch">+ New launch</Link>
            <button className="adm-out" onClick={() => { sessionStorage.removeItem('adm'); setAuthed(false) }}>Lock</button>
          </div>
        </div>

        {/* Isolated admin launch panel (its own copy — not the public /launch) */}
        <div className="adm-launchbox"><AdminLaunch auth={auth} /></div>

        <div className="adm-stats">
          <div className="adm-stat"><span>Launches</span><b>{rows.length}</b></div>
          <div className="adm-stat"><span>Total market cap</span><b>{usd(totMc, eth)}</b></div>
          <div className="adm-stat"><span>24h volume</span><b>{usd(totVol, eth)}</b></div>
          <div className="adm-stat"><span>Holders</span><b>{totHolders.toLocaleString()}</b></div>
        </div>

        <div className="adm-panel">
          <table className="adm-table">
            <thead><tr><th>Token</th><th>Market cap</th><th>24h</th><th>Holders</th><th>Grad</th><th>Fees</th><th>Age</th><th>Links</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.address}>
                  <td><div className="adm-tok"><div className="adm-img">{t.image_url ? <img src={t.image_url} alt="" onError={(e) => e.target.remove()} /> : (t.symbol || '?')[0].toUpperCase()}</div><div><b>{t.symbol}</b><span>{shortAddr(t.address)}</span></div></div></td>
                  <td>{usd(t.marketCapEth, eth)}</td>
                  <td className={(t.priceChange24h || 0) >= 0 ? 'up' : 'down'}>{(t.priceChange24h || 0).toFixed(1)}%</td>
                  <td>{t.holders ?? 0}</td>
                  <td>{Math.round(t.graduationPct || 0)}%</td>
                  <td>{t.fee_mode && t.fee_mode !== 'keep' ? t.fee_mode : '—'}</td>
                  <td>{fmtAge(t.created_at)}</td>
                  <td className="adm-links"><Link to={'/admin/launch/' + t.address} style={{ color: 'var(--green)', fontWeight: 700 }}>bundler</Link><Link to={'/coin/' + t.address}>coin</Link><a href={EXPLORER + '/token/' + t.address} target="_blank" rel="noopener">scan</a></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan="8" className="adm-empty">No launches yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
