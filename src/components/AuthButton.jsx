import { useEffect, useState } from 'react'
import { createPublicClient, http, defineChain } from 'viem'
import { Connection, PublicKey } from '@solana/web3.js'
import { API, authFetch, shortAddr } from '../api'

const RH = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } })
const rhClient = createPublicClient({ chain: RH, transport: http() })
const solConn = new Connection(API + '/api/solana-rpc')
const fmtBal = (n, d) => (n == null ? '—' : n > 0 && n < 1 / 10 ** d ? '<' + (1 / 10 ** d) : n.toFixed(d))

// Top-right auth control: RH + Solana wallet chips (address + balance) then the
// profile button. Plus the first-login profile modal (username + avatar).
export default function AuthButton({ auth }) {
  const { ready, authenticated, solana, token, profile, setProfile, login, logout, evmAddress } = auth
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState('')
  const [saving, setSaving] = useState(false)
  const [ethBal, setEthBal] = useState(null)
  const [solBal, setSolBal] = useState(null)

  // live balances for the two wallets shown in the header
  useEffect(() => {
    if (!evmAddress) { setEthBal(null); return }
    let alive = true
    const load = () => rhClient.getBalance({ address: evmAddress }).then((b) => alive && setEthBal(Number(b) / 1e18)).catch(() => {})
    load(); const i = setInterval(load, 15000)
    return () => { alive = false; clearInterval(i) }
  }, [evmAddress])
  useEffect(() => {
    if (!solana) { setSolBal(null); return }
    let alive = true
    const load = () => solConn.getBalance(new PublicKey(solana)).then((b) => alive && setSolBal(b / 1e9)).catch(() => {})
    load(); const i = setInterval(load, 15000)
    return () => { alive = false; clearInterval(i) }
  }, [solana])

  // prompt for a profile the first time a wallet logs in with no username
  useEffect(() => {
    if (authenticated && profile && !profile.username) setOpen(true)
  }, [authenticated, profile])

  useEffect(() => {
    if (profile) { setUsername(profile.username || ''); setAvatar(profile.avatar_url || '') }
  }, [profile])

  async function uploadAvatar(file) {
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = 200; c.height = 200
    const s = Math.min(bmp.width, bmp.height)
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 200, 200)
    const data = c.toDataURL('image/webp', 0.9).split(',')[1]
    const r = await fetch(API + '/api/upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, mime: 'image/webp' }),
    }).then((x) => x.json())
    setAvatar(r.url)
  }

  async function save() {
    setSaving(true)
    try {
      const r = await authFetch('/api/me/profile', token, solana, {
        method: 'PATCH', body: JSON.stringify({ username, avatar_url: avatar }),
      })
      if (r.ok) { setProfile((await r.json()).profile); setOpen(false) }
    } finally { setSaving(false) }
  }

  if (!ready) return null

  return (
    <>
      <div id="hl-auth" style={{ position: 'fixed', top: 14, right: 18, zIndex: 200, display: 'flex', alignItems: 'center', gap: 8 }}>
        {authenticated && solana && (
          <>
            <div className="wchip" title="Your Robinhood Chain trading wallet (holds bought tokens)">
              <img src="/robinhood.png" alt="RH" />
              <span className="waddr">{shortAddr(evmAddress)}</span>
              <b className="wbal">{fmtBal(ethBal, 4)} ETH</b>
            </div>
            <div className="wchip" title="Your Solana wallet (Phantom)">
              <img src="/solana.png" alt="SOL" />
              <span className="waddr">{shortAddr(solana)}</span>
              <b className="wbal">{fmtBal(solBal, 3)} SOL</b>
            </div>
          </>
        )}
        {authenticated && solana ? (
          <button className="hl-authbtn on" onClick={() => setOpen(true)}>
            {profile?.avatar_url && <img src={profile.avatar_url} alt="" className="hl-auth-av" />}
            {profile?.username || shortAddr(solana)}
          </button>
        ) : (
          <button className="hl-authbtn" onClick={login}>Log in</button>
        )}
      </div>

      {open && authenticated && (
        <div className="pv-modal" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="pv-card">
            <div className="pv-head"><b>Your profile</b><button className="pv-x" onClick={() => setOpen(false)}>✕</button></div>
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
            <button className="pv-logout" onClick={logout}>Log out</button>
          </div>
        </div>
      )}
    </>
  )
}
