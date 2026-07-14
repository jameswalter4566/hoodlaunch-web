import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, authFetch, usd, ethUsd, shortAddr } from '../api'

export default function Profile({ auth }) {
  const { authenticated, solana, token, profile, login } = auth
  const [launches, setLaunches] = useState([])
  const [eth, setEth] = useState(0)
  const [fees, setFees] = useState({})
  const [claiming, setClaiming] = useState({})

  useEffect(() => {
    if (!authenticated || !token || !solana) return
    let alive = true
    ethUsd().then((v) => alive && setEth(v))
    authFetch('/api/me/launches', token, solana).then((r) => r.json()).then(async (d) => {
      if (!alive) return
      setLaunches(d.launches || [])
      for (const t of d.launches || []) {
        const f = await fetch(API + '/api/fees/' + t.position_id).then((r) => r.json()).catch(() => ({}))
        if (alive) setFees((prev) => ({ ...prev, [t.position_id]: f.creatorEth || 0 }))
      }
    })
    return () => { alive = false }
  }, [authenticated, token, solana])

  async function claim(pos) {
    setClaiming((p) => ({ ...p, [pos]: 'Claiming…' }))
    try {
      const r = await authFetch('/api/claim', token, solana, { method: 'POST', body: JSON.stringify({ positionId: pos }) })
      const out = await r.json()
      if (!r.ok) throw new Error(out.error || 'failed')
      setClaiming((p) => ({ ...p, [pos]: out.delivered === 'sol' ? '✓ SOL sent to Phantom' : (out.note || 'done') }))
    } catch (e) { setClaiming((p) => ({ ...p, [pos]: e.message })) }
  }

  if (!authenticated) return (
    <div className="main"><div className="pf-wrap"><div className="pf-empty"><button className="hl-cta" style={{ maxWidth: 260 }} onClick={login}>Log in with Phantom</button></div></div></div>
  )

  const totalFees = Object.values(fees).reduce((a, b) => a + b, 0)

  return (
    <div className="main">
      <div className="pf-wrap">
        <div className="pf-head">
          <div className="pf-avatar">{profile?.avatar_url ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : (solana || '?').slice(0, 2).toUpperCase()}</div>
          <div><div className="pf-name">{profile?.username || shortAddr(solana)}</div><div className="pf-sub">{solana}</div></div>
        </div>
        <div className="pf-earn">
          <div className="pf-earn-box"><span>Unclaimed fees</span><b>{usd(totalFees, eth)}</b><small>bridged to your Phantom as SOL</small></div>
          <div className="pf-earn-box"><span>Your launches</span><b>{launches.length}</b></div>
        </div>
        {launches.length > 0 && <h3 className="pf-h3">Your launches</h3>}
        <div className="pf-launches">
          {launches.map((t) => (
            <div className="pf-row" key={t.position_id}>
              <div className="pf-row-img">{t.image_url ? <img src={t.image_url} alt="" onError={(e) => e.target.remove()} /> : (t.symbol || '?')[0].toUpperCase()}</div>
              <div className="pf-row-main">
                <Link to={'/coin/' + t.address}><b>{t.symbol}</b> <span>{t.name}</span></Link>
                <div className="pf-row-fee">{claiming[t.position_id] || (fees[t.position_id] > 0 ? usd(fees[t.position_id], eth) + ' claimable' : 'no fees yet')}</div>
              </div>
              <button className="pf-claim" onClick={() => claim(t.position_id)}>Claim</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
