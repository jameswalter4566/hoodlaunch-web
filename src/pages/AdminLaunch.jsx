import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Connection, Transaction, PublicKey, TransactionInstruction, Keypair, VersionedTransaction } from '@solana/web3.js'
import { API, RELAY, EXPLORER } from '../api'
import WalletStrip from './WalletStrip.jsx'

// AdminLaunch — an isolated copy of the public launch panel, rendered ONLY inside
// the PIN-gated /admin page. Starts identical to Launch.jsx; admin-only tweaks
// (like the reference-wallet strip) live here so the public /launch stays clean.

const SOLANA_RPC = API + '/api/solana-rpc'
const hexToBytes = (hex) => {
  const h = hex.replace(/^0x/, '')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16)
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shortHash = (h) => (h ? h.slice(0, 10) + '…' + h.slice(-8) : '')

// What happens to the token's LP trading fees (Robinhood Chain launches).
const FEE_MODES = [
  { id: 'keep', icon: '💰', title: 'Keep fees', desc: 'All LP trading fees go straight to your wallet.' },
  { id: 'buyback', icon: '🔥', title: 'Buyback flywheel', desc: 'Fees auto-buy your token for constant buy pressure; bought tokens land in your dev wallet.' },
  { id: 'split', icon: '⚖️', title: 'Split 50 / 50', desc: 'Half the fees to you, half into automatic buybacks.' },
  { id: 'lp', icon: '🌊', title: 'Compound LP', desc: 'Fees are added back into the pool — deeper liquidity, higher runners.' },
  { id: 'airdrop', icon: '🎁', title: 'Airdrop to holders', desc: 'Fees are distributed to your token holders, pro-rata.' },
]

export default function AdminLaunch({ auth }) {
  const { authenticated, solana, primaryWallet, login, evmAddress } = auth
  const navigate = useNavigate()
  const [f, setF] = useState({ name: '', symbol: '', description: '', twitter: '', telegram: '', website: '', initialBuySol: '' })
  const [imageUrl, setImageUrl] = useState('')
  const [status, setStatus] = useState('')
  const [statusCls, setStatusCls] = useState('')
  const [chain, setChain] = useState('robinhood') // 'robinhood' | 'solana' (pump.fun)
  const [feeMode, setFeeMode] = useState('keep') // keep | buyback | split | lp | airdrop
  // launching overlay: { active, pct, label, done, error, txHash, address }
  const [lx, setLx] = useState({ active: false })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const bundleRef = useRef(null) // reference/bundle wallets that snipe on launch

  async function onImage(file) {
    if (file.size > 4_500_000) { setStatus('Image too large (max 4.5MB)'); setStatusCls('hl-err'); return }
    const bmp = await createImageBitmap(file)
    const c = document.createElement('canvas'); c.width = 250; c.height = 250
    const s = Math.min(bmp.width, bmp.height)
    c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 250, 250)
    const data = c.toDataURL('image/webp', 0.9).split(',')[1]
    const r = await fetch(API + '/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, mime: 'image/webp' }) }).then((x) => x.json())
    setImageUrl(r.url)
  }

  async function launch() {
    // pre-launch validation stays inline on the form
    if (!authenticated) return login()
    if (!f.name || !f.symbol) { setStatus('Coin name and ticker are required'); setStatusCls('hl-err'); return }
    if (!imageUrl) { setStatus('Upload a logo image first'); setStatusCls('hl-err'); return }
    setStatus(''); setStatusCls('')
    setLx({ active: true, pct: 8, label: 'Preparing your launch…' })
    try {
      // initial-buy tokens go to the user's silent embedded EVM wallet (so the
      // creator can later sell them); fees still route to treasury -> their SOL.
      const creator = evmAddress
      if (!creator) throw new Error('Your trading wallet is still setting up — try again in a moment')

      let initialBuyEth
      if (Number(f.initialBuySol) > 0) {
        const [e, sol] = await Promise.all(['ETH-USD', 'SOL-USD'].map((p) => fetch('https://api.coinbase.com/v2/prices/' + p + '/spot').then((r) => r.json()).then((x) => Number(x.data.amount))))
        initialBuyEth = ((Number(f.initialBuySol) * sol) / e).toFixed(8)
      }

      setLx((l) => ({ ...l, pct: 18, label: 'Pinning metadata to IPFS & quoting…' }))
      const res = await fetch(API + '/api/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, symbol: f.symbol, description: f.description, imageUrl, socials: { twitter: f.twitter, telegram: f.telegram, website: f.website }, creator, solanaAddress: solana, initialBuyEth, feeMode }),
      })
      const out = await res.json()
      const quote = out.relayQuote
      if (!res.ok || !quote?.steps) throw new Error(quote?.message || out.error || 'Quote failed')

      setLx((l) => ({ ...l, pct: 28, label: 'Approve ' + Number(quote.details.currencyIn.amountFormatted).toFixed(4) + ' SOL in Phantom…' }))
      const conn = new Connection(SOLANA_RPC)
      const tx = new Transaction()
      quote.steps.forEach((step) => step.items.forEach((item) => (item.data.instructions || []).forEach((ins) => {
        tx.add(new TransactionInstruction({ programId: new PublicKey(ins.programId), keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: hexToBytes(ins.data) }))
      })))
      tx.feePayer = new PublicKey(solana)
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
      // sign with the Privy-connected Solana wallet
      await primaryWallet.sendTransaction(tx, conn)
      setLx((l) => ({ ...l, pct: 40, label: 'Launching on Robinhood Chain…' }))

      const check = quote.steps[0].items[0].check
      let dst = null
      for (let i = 0; i < 45; i++) {
        await sleep(2000)
        const st = await fetch(RELAY + check.endpoint).then((r) => r.json())
        if (st.status === 'success') { dst = st.txHashes?.[0]; break }
        if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status + ' — SOL refunded if deducted.')
        setLx((l) => ({ ...l, pct: Math.min(80, 40 + i * 4), label: 'Launching on Robinhood Chain…' }))
      }
      if (!dst) throw new Error('Still filling — check relay.link with your wallet.')

      // decode the new token address from the launch tx so we can jump to /coin
      setLx((l) => ({ ...l, pct: 88, label: 'Confirming your coin…', txHash: dst }))
      let address = null
      for (let i = 0; i < 20; i++) {
        const r = await fetch(API + '/api/launch/result/' + dst).then((x) => (x.ok ? x.json() : null)).catch(() => null)
        if (r?.address) { address = r.address; break }
        await sleep(1500)
      }

      // fire the bundle-wallet snipes the instant the token address is known.
      // Sniped tokens land in the admin's trading (embedded EVM) wallet.
      if (address && bundleRef.current?.hasSnipers()) {
        setLx((l) => ({ ...l, pct: 96, label: 'Sniping with bundle wallets…' }))
        try { await bundleRef.current.fire(address, creator) } catch { /* per-wallet errors shown on each row */ }
      }

      setLx((l) => ({ ...l, active: true, done: true, pct: 100, txHash: dst, address, symbol: f.symbol }))
      if (address) { await sleep(1500); navigate('/coin/' + address.toLowerCase()) }
    } catch (e) {
      setLx((l) => ({ ...l, done: true, error: e.message || String(e) }))
    }
  }

  // Launch a REAL pump.fun token on Solana via PumpPortal, signed by the user's
  // Phantom (Privy) wallet. Metadata is pinned to our IPFS; the token then shows
  // on pump.fun / Axiom.
  async function launchSolana() {
    if (!authenticated) return login()
    if (!f.name || !f.symbol) { setStatus('Coin name and ticker are required'); setStatusCls('hl-err'); return }
    if (!imageUrl) { setStatus('Upload a logo image first'); setStatusCls('hl-err'); return }
    setStatus(''); setStatusCls('')
    setLx({ active: true, pct: 12, label: 'Pinning metadata to IPFS…' })
    try {
      const meta = await fetch(API + '/api/pump/metadata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, symbol: f.symbol, description: f.description, imageUrl, socials: { twitter: f.twitter, telegram: f.telegram, website: f.website } }),
      }).then((r) => r.json())
      if (!meta.uri) throw new Error(meta.error || 'metadata pin failed')

      const mintKeypair = Keypair.generate()
      setLx((l) => ({ ...l, pct: 35, label: 'Building pump.fun transaction…' }))
      const devBuy = Number(f.initialBuySol) > 0 ? Number(f.initialBuySol) : 0
      const resp = await fetch('https://pumpportal.fun/api/trade-local', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey: solana,
          action: 'create',
          tokenMetadata: { name: f.name, symbol: f.symbol, uri: meta.uri },
          mint: mintKeypair.publicKey.toBase58(),
          denominatedInSol: 'true',
          amount: devBuy,
          slippage: 10,
          priorityFee: 0.00005,
          pool: 'pump',
        }),
      })
      if (!resp.ok) throw new Error('pump.fun error ' + resp.status + ' — ' + (await resp.text()).slice(0, 120))
      const buf = new Uint8Array(await resp.arrayBuffer())
      const tx = VersionedTransaction.deserialize(buf)
      tx.sign([mintKeypair]) // the new mint account co-signs
      setLx((l) => ({ ...l, pct: 62, label: 'Approve in Phantom…' }))
      const conn = new Connection(SOLANA_RPC)
      const sig = await primaryWallet.sendTransaction(tx, conn)
      const mint = mintKeypair.publicKey.toBase58()
      setLx((l) => ({ ...l, active: true, done: true, pct: 100, txHash: sig, address: mint, symbol: f.symbol, solana: true }))
    } catch (e) {
      setLx((l) => ({ ...l, done: true, error: e.message || String(e) }))
    }
  }

  return (
    <div className="main">
      <main className="hl-main">
        <section className="hl-card">
          <div className="hl-head"><h2 className="hl-title">Launch a coin</h2><span className="hl-pill">LIVE</span></div>
          <p className="hl-sub">{chain === 'solana' ? 'Launch on pump.fun — signed from your Phantom wallet' : 'Deploy on Robinhood Chain — pay straight from your Solana wallet'}</p>

          <div className="lc-chain">
            <button className={chain === 'robinhood' ? 'on' : ''} onClick={() => setChain('robinhood')}>Robinhood Chain</button>
            <button className={chain === 'solana' ? 'on' : ''} onClick={() => setChain('solana')}>Solana · pump.fun</button>
          </div>

          <WalletStrip ref={bundleRef} />

          <label className="hl-label">Logo Image <span className="hl-req">*</span></label>
          <div className="hl-uploadrow">
            <label className="hl-logo-box hl-logo-clickable">
              {imageUrl ? <img src={imageUrl} alt="" /> : <><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg><span>Upload</span></>}
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onImage(e.target.files[0])} />
            </label>
            <ul className="hl-hints"><li>PNG, JPEG, WebP, or GIF</li><li>Square, resized to 250×250</li><li>Pinned to IPFS</li></ul>
          </div>

          <div className="hl-grid2">
            <div><label className="hl-label">Coin Name <span className="hl-req">*</span></label><input className="hl-input" maxLength={60} value={f.name} onChange={set('name')} placeholder="Plasma Wizard" /></div>
            <div><label className="hl-label">Ticker <span className="hl-req">*</span></label><input className="hl-input" maxLength={20} value={f.symbol} onChange={set('symbol')} placeholder="PLAS" /></div>
          </div>
          <label className="hl-label">Description</label>
          <textarea className="hl-textarea" maxLength={256} value={f.description} onChange={set('description')} placeholder="Describe your coin..." />
          <div className="hl-grid2">
            <div><div className="hl-social-label">Twitter / X</div><input className="hl-input" value={f.twitter} onChange={set('twitter')} placeholder="@username" /></div>
            <div><div className="hl-social-label">Telegram</div><input className="hl-input" value={f.telegram} onChange={set('telegram')} placeholder="@username" /></div>
            <div><div className="hl-social-label">Website</div><input className="hl-input" value={f.website} onChange={set('website')} placeholder="example.com" /></div>
          </div>
          <label className="hl-label">Initial Buy (SOL)</label>
          <input className="hl-input" type="number" min="0" step="0.01" value={f.initialBuySol} onChange={set('initialBuySol')} placeholder="0.0" />
          <div className="hl-fieldnote">Optional — buy your own coin in the same transaction, paid in SOL.</div>

          {chain === 'robinhood' && (
            <>
              <label className="hl-label">Fee strategy</label>
              <div className="fee-modes">
                {FEE_MODES.map((m) => (
                  <button key={m.id} type="button" className={'fee-mode' + (feeMode === m.id ? ' on' : '')} onClick={() => setFeeMode(m.id)}>
                    <div className="fee-mode-t">{m.icon} {m.title}</div>
                    <div className="fee-mode-d">{m.desc}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="hl-fee">{chain === 'solana' ? <>Launches on <b>pump.fun</b> · bonding curve · shows on Axiom</> : <>LP locked forever · fees claimable as SOL · Est. bridge time: <b>~2s</b></>}</div>
          <button className="hl-cta" onClick={chain === 'solana' ? launchSolana : launch}>{!authenticated ? 'Log in to Launch' : chain === 'solana' ? 'Launch on pump.fun' : 'Launch Coin'}</button>
          <div className={'hl-status ' + statusCls}>{status}</div>
        </section>
        <aside className="hl-side">
          <div className="hl-sidebox"><h3>Required</h3><ul><li>Coin name &amp; ticker</li><li>Logo image</li></ul><h4>Optional</h4><ul><li>Description &amp; socials</li><li>Initial buy (SOL)</li></ul></div>
          <div className="hl-sidebox hl-sidebox-gold"><h3>How it works</h3><ol><li>Fill in your coin details</li><li>Sign one SOL transaction with Phantom</li><li>Relay launches it on Robinhood Chain (~2s)</li><li>LP locked forever, trades instantly</li><li>Claim your creator fees as SOL</li></ol></div>
        </aside>
      </main>

      {lx.active && (
        <div className="lx-overlay">
          <div className="lx-card">
            {!lx.done ? (
              <>
                <div className="lx-logo">{imageUrl ? <img src={imageUrl} alt="" /> : (f.symbol || '?')[0].toUpperCase()}</div>
                <div className="lx-title">Launching {f.symbol || 'your coin'}…</div>
                <div className="lx-bar"><i style={{ width: (lx.pct || 0) + '%' }} /></div>
                <div className="lx-stage">{lx.label}</div>
              </>
            ) : lx.error ? (
              <>
                <div className="lx-title lx-err">Launch didn’t complete</div>
                <div className="lx-stage">{lx.error}</div>
                <button className="lx-btn lx-btn-ghost" onClick={() => setLx({ active: false })}>Close</button>
              </>
            ) : (
              <>
                <div className="lx-logo lx-logo-live">{imageUrl ? <img src={imageUrl} alt="" /> : (lx.symbol || '?')[0].toUpperCase()}</div>
                <div className="lx-title">🚀 {lx.symbol} is live!</div>
                {lx.solana ? (
                  <>
                    {lx.txHash && <a className="lx-tx" href={'https://solscan.io/tx/' + lx.txHash} target="_blank" rel="noopener">{shortHash(lx.txHash)} ↗</a>}
                    <button className="lx-btn" onClick={() => window.open('https://pump.fun/' + lx.address, '_blank')}>View on pump.fun →</button>
                  </>
                ) : (
                  <>
                    {lx.txHash && <a className="lx-tx" href={EXPLORER + '/tx/' + lx.txHash} target="_blank" rel="noopener">{shortHash(lx.txHash)} ↗</a>}
                    {lx.address ? (
                      <button className="lx-btn" onClick={() => navigate('/coin/' + lx.address)}>View your coin →</button>
                    ) : (
                      <div className="lx-stage">Indexing — it’ll appear in the feed shortly.</div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
