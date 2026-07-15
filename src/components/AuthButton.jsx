import { useEffect, useState } from 'react'
import { createPublicClient, http, defineChain } from 'viem'
import { Connection, PublicKey } from '@solana/web3.js'
import { API, authFetch, shortAddr, RELAY } from '../api'

const RH = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } })
const rhClient = createPublicClient({ chain: RH, transport: http() })
const solConn = new Connection(API + '/api/solana-rpc')
const fmtBal = (n, d) => (n == null ? '—' : n > 0 && n < 1 / 10 ** d ? '<' + (1 / 10 ** d) : n.toFixed(d))

// Top-right auth control: RH + Solana wallet chips (address + balance) then the
// profile button. Plus the first-login profile modal (username + avatar).
export default function AuthButton({ auth }) {
  const { ready, authenticated, solana, token, profile, setProfile, login, logout, evmAddress, evmWallet } = auth
  const [open, setOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [avatar, setAvatar] = useState('')
  const [saving, setSaving] = useState(false)
  const [ethBal, setEthBal] = useState(null)
  const [solBal, setSolBal] = useState(null)
  const [bridgeOpen, setBridgeOpen] = useState(false)
  const [bAmt, setBAmt] = useState('')
  const [bStatus, setBStatus] = useState('')

  // Bridge ETH (Robinhood Chain, embedded wallet) -> SOL (Phantom) via Relay.
  async function bridge() {
    try {
      const amtEth = parseFloat(bAmt)
      if (!(amtEth > 0)) { setBStatus('Enter an amount'); return }
      if (amtEth > (ethBal || 0)) { setBStatus('Not enough ETH'); return }
      const ethWei = BigInt(Math.floor(amtEth * 1e18)).toString()
      setBStatus('Getting quote…')
      const q = await fetch(API + '/api/quote/bridge?ethWei=' + ethWei + '&evmAddress=' + evmAddress + '&solanaRecipient=' + solana).then((r) => r.json())
      if (!q.steps) throw new Error(q.message || 'Quote failed')
      setBStatus('Approve in your wallet…')
      try { await evmWallet.switchChain(4663) } catch {}
      const provider = await evmWallet.getEthereumProvider()
      let check = null
      for (const step of q.steps) {
        for (const it of step.items || []) {
          if (it.status === 'complete') continue
          const t = it.data
          const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: evmAddress, to: t.to, data: t.data || '0x', value: t.value ? '0x' + BigInt(t.value).toString(16) : '0x0' }] })
          await rhClient.waitForTransactionReceipt({ hash })
          if (it.check) check = it.check
        }
      }
      setBStatus('Bridging to Phantom…')
      if (check) {
        for (let i = 0; i < 45; i++) { await new Promise((r) => setTimeout(r, 2000)); const st = await fetch(RELAY + check.endpoint).then((r) => r.json()); if (st.status === 'success') { setBStatus('✅ SOL sent to your Phantom'); return } if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status) }
      }
      setBStatus('✅ Sent')
    } catch (e) { setBStatus(e.message || String(e)) }
  }

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
            <button className="wchip wchip-btn" title="Bridge ETH → SOL" onClick={() => { setBAmt(''); setBStatus(''); setBridgeOpen(true) }}>
              <img src="/robinhood.png" alt="RH" />
              <span className="waddr">{shortAddr(evmAddress)}</span>
              <b className="wbal">{fmtBal(ethBal, 4)} ETH</b>
            </button>
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

      {bridgeOpen && authenticated && (
        <div className="pv-modal" onClick={(e) => e.target === e.currentTarget && setBridgeOpen(false)}>
          <div className="pv-card br-card">
            <div className="pv-head"><b>Bridge to SOL</b><button className="pv-x" onClick={() => setBridgeOpen(false)}>✕</button></div>
            <div className="br-box">
              <div className="br-box-top"><span>From</span><span className="br-tok"><img src="/robinhood.png" alt="" /> ETH</span></div>
              <input className="br-amt" type="number" min="0" value={bAmt} onChange={(e) => setBAmt(e.target.value)} placeholder="0" />
              <div className="br-box-bot"><span>Balance {fmtBal(ethBal, 5)}</span>
                <span className="br-presets">
                  <button onClick={() => setBAmt((((ethBal || 0) * 0.25)).toFixed(6))}>25%</button>
                  <button onClick={() => setBAmt((((ethBal || 0) * 0.5)).toFixed(6))}>50%</button>
                  <button onClick={() => setBAmt(Math.max(0, (ethBal || 0) - 0.0006).toFixed(6))}>MAX</button>
                </span>
              </div>
            </div>
            <div className="br-arrow">↓</div>
            <div className="br-box">
              <div className="br-box-top"><span>To (your Phantom)</span><span className="br-tok"><img src="/solana.png" alt="" /> SOL</span></div>
              <div className="br-to">{shortAddr(solana)}</div>
            </div>
            <button className="pv-save" onClick={bridge}>Bridge to Phantom</button>
            <div className="br-status">{bStatus}</div>
          </div>
        </div>
      )}
    </>
  )
}
