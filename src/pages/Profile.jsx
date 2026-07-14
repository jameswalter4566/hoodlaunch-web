import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, authFetch, usd, ethUsd, fmtAge, shortAddr } from '../api'

export default function Profile({ auth }) {
  const { authenticated, solana, token, profile, setProfile, login } = auth
  const [launches, setLaunches] = useState([])
  const [eth, setEth] = useState(0)
  const [fees, setFees] = useState({})
  const [claiming, setClaiming] = useState({})
  const [copied, setCopied] = useState(false)
  const [edit, setEdit] = useState(false)

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

  function copyAddr() {
    navigator.clipboard.writeText(solana)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  if (!authenticated) return (
    <div className="main"><div className="pf2-wrap"><div className="pf2-guest">
      <div className="pf2-guest-txt">Log in with your Phantom wallet to see your profile, launches and creator fees.</div>
      <button className="pf2-cta" onClick={login}>Log in with Phantom</button>
    </div></div></div>
  )

  const totalFees = Object.values(fees).reduce((a, b) => a + b, 0)
  const claimableCount = Object.values(fees).filter((f) => f > 0).length
  const since = profile?.created_at ? new Date(profile.created_at) : null

  return (
    <div className="main">
      <div className="pf2-wrap">
        {/* header */}
        <div className="pf2-head">
          <div className="pf2-av">
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : (solana || '?').slice(0, 2).toUpperCase()}
          </div>
          <div className="pf2-id">
            <div className="pf2-name">{profile?.username || shortAddr(solana)}</div>
            <div className="pf2-chips">
              <button className="pf2-chip" onClick={copyAddr}>{copied ? 'Copied!' : shortAddr(solana)} <span className="pf2-chip-i">⧉</span></button>
              <a className="pf2-chip" href={'https://solscan.io/account/' + solana} target="_blank" rel="noopener">Solscan <span className="pf2-chip-i">↗</span></a>
            </div>
          </div>
          <button className="pf2-edit" onClick={() => setEdit(true)}>Edit profile</button>
        </div>

        {/* stats */}
        <div className="pf2-stats">
          <div className="pf2-stat"><span>Launches</span><b>{launches.length}</b><small>tokens created</small></div>
          <div className="pf2-stat"><span>Unclaimed fees</span><b>{usd(totalFees, eth)}</b><small>claimable as SOL</small></div>
          <div className="pf2-stat"><span>Claimable</span><b>{claimableCount}</b><small>{claimableCount === 1 ? 'position' : 'positions'} with fees</small></div>
          <div className="pf2-stat"><span>Member since</span><b>{since ? since.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}</b><small>{since ? fmtAge(since.toISOString()) + ' ago' : ''}</small></div>
        </div>

        {/* launches panel */}
        <div className="pf2-panel">
          <div className="pf2-panel-head">
            <div className="pf2-panel-title">Your launches <span className="pf2-badge">{launches.length}</span></div>
            <Link className="pf2-panel-cta" to="/launch">+ Launch a token</Link>
          </div>
          {launches.length === 0 ? (
            <div className="pf2-empty">You haven’t launched a token yet.</div>
          ) : (
            <div className="pf2-list">
              {launches.map((t) => (
                <div className="pf2-row" key={t.position_id}>
                  <Link className="pf2-row-img" to={'/coin/' + t.address}>{t.image_url ? <img src={t.image_url} alt="" onError={(e) => e.target.remove()} /> : (t.symbol || '?')[0].toUpperCase()}</Link>
                  <div className="pf2-row-main">
                    <Link to={'/coin/' + t.address} className="pf2-row-nm"><b>{t.symbol}</b> <span>{t.name}</span></Link>
                    <div className="pf2-row-sub">{claiming[t.position_id] || (fees[t.position_id] > 0 ? usd(fees[t.position_id], eth) + ' in fees claimable' : 'no fees accrued yet')}</div>
                  </div>
                  <button className="pf2-claim" disabled={!(fees[t.position_id] > 0)} onClick={() => claim(t.position_id)}>Claim</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {edit && <EditModal auth={auth} setProfile={setProfile} onClose={() => setEdit(false)} />}
    </div>
  )
}

// Inline edit modal (username + avatar) — same PATCH the first-login modal uses.
function EditModal({ auth, setProfile, onClose }) {
  const { token, solana, profile } = auth
  const [username, setUsername] = useState(profile?.username || '')
  const [avatar, setAvatar] = useState(profile?.avatar_url || '')
  const [saving, setSaving] = useState(false)

  async function uploadAvatar(file) {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = 200; c.height = 200
    const s = Math.min(bmp.width, bmp.height)
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 200, 200)
    const data = c.toDataURL('image/webp', 0.9).split(',')[1]
    const r = await fetch(API + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, mime: 'image/webp' }) }).then((x) => x.json())
    setAvatar(r.url)
  }

  async function save() {
    setSaving(true)
    try {
      const r = await authFetch('/api/me/profile', token, solana, { method: 'PATCH', body: JSON.stringify({ username, avatar_url: avatar }) })
      if (r.ok) { setProfile((await r.json()).profile); onClose() }
    } finally { setSaving(false) }
  }

  return (
    <div className="pv-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pv-card">
        <div className="pv-head"><b>Edit profile</b><button className="pv-x" onClick={onClose}>✕</button></div>
        <div className="pv-avwrap">
          <label className="pv-av">
            {avatar ? <img src={avatar} alt="" /> : <span>＋</span>}
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && uploadAvatar(e.target.files[0])} />
          </label>
          <div className="pv-avhint">Profile photo</div>
        </div>
        <label className="pv-label">Username</label>
        <input className="pv-input" value={username} maxLength={24} onChange={(e) => setUsername(e.target.value)} placeholder="degen123" />
        <div className="pv-wallet">Wallet: {shortAddr(solana)}</div>
        <button className="pv-save" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save profile'}</button>
      </div>
    </div>
  )
}
