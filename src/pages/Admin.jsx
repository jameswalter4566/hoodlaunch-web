import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, EXPLORER, usd, ethUsd, fmtAge, shortAddr } from '../api'
import AdminLaunch from './AdminLaunch.jsx'

// Private admin dashboard: PIN gate (validated server-side via ADMIN_PIN — the PIN
// never ships in the bundle), a 1:1 launch form, and a read-only launch monitor.
export default function Admin({ auth }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem('adm') === '1')
  const [entry, setEntry] = useState('')
  const [rows, setRows] = useState([])
  const [eth, setEth] = useState(0)

  useEffect(() => {
    if (!authed) return
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
  }, [authed])

  async function submit(e) {
    e.preventDefault()
    try {
      const r = await fetch(API + '/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: entry }) }).then((x) => x.json())
      if (r.ok) { sessionStorage.setItem('adm', '1'); setAuthed(true) } else setEntry('')
    } catch { setEntry('') }
  }

  if (!authed) return (
    <div className="main adm-gate">
      <form className="adm-pin" onSubmit={submit}>
        <div className="adm-pin-t">Admin access</div>
        <input autoFocus inputMode="numeric" maxLength={4} value={entry} onChange={(e) => setEntry(e.target.value.replace(/\D/g, ''))} placeholder="••••" />
        <button type="submit">Enter</button>
      </form>
    </div>
  )

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
                  <td className="adm-links"><Link to={'/coin/' + t.address}>coin</Link><a href={EXPLORER + '/token/' + t.address} target="_blank" rel="noopener">scan</a></td>
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
