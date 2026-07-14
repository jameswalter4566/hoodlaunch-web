import { useState } from 'react'
import { Connection, Transaction, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { API, RELAY, EXPLORER } from '../api'

const SOLANA_RPC = API + '/api/solana-rpc'
const hexToBytes = (hex) => {
  const h = hex.replace(/^0x/, '')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16)
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export default function Launch({ auth }) {
  const { authenticated, solana, primaryWallet, login } = auth
  const [f, setF] = useState({ name: '', symbol: '', description: '', twitter: '', telegram: '', website: '', initialBuySol: '' })
  const [imageUrl, setImageUrl] = useState('')
  const [status, setStatus] = useState('')
  const [statusCls, setStatusCls] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

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
    try {
      if (!authenticated) return login()
      if (!f.name || !f.symbol) throw new Error('Coin name and ticker are required')
      if (!imageUrl) throw new Error('Upload a logo image first')
      // creator EVM address = the user's Phantom-derived Ethereum address (fees route via router to their SOL)
      let creator = null
      try { creator = (await window.phantom.ethereum.request({ method: 'eth_requestAccounts' }))[0] } catch {}
      if (!creator) throw new Error('Connect Phantom to continue')

      let initialBuyEth
      if (Number(f.initialBuySol) > 0) {
        setStatus('Converting SOL → ETH…'); setStatusCls('')
        const [e, sol] = await Promise.all(['ETH-USD', 'SOL-USD'].map((p) => fetch('https://api.coinbase.com/v2/prices/' + p + '/spot').then((r) => r.json()).then((x) => Number(x.data.amount))))
        initialBuyEth = ((Number(f.initialBuySol) * sol) / e).toFixed(8)
      }

      setStatus('Getting launch quote…')
      const res = await fetch(API + '/api/launch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, symbol: f.symbol, description: f.description, imageUrl, socials: { twitter: f.twitter, telegram: f.telegram, website: f.website }, creator, solanaAddress: solana, initialBuyEth }),
      })
      const out = await res.json()
      const quote = out.relayQuote
      if (!res.ok || !quote?.steps) throw new Error(quote?.message || out.error || 'Quote failed')

      setStatus('Sign in Phantom — total ' + Number(quote.details.currencyIn.amountFormatted).toFixed(4) + ' SOL')
      const conn = new Connection(SOLANA_RPC)
      const tx = new Transaction()
      quote.steps.forEach((step) => step.items.forEach((item) => (item.data.instructions || []).forEach((ins) => {
        tx.add(new TransactionInstruction({ programId: new PublicKey(ins.programId), keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: hexToBytes(ins.data) }))
      })))
      tx.feePayer = new PublicKey(solana)
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
      // sign with the Privy-connected Solana wallet
      const sent = await primaryWallet.sendTransaction(tx, conn)
      setStatus('Sent — waiting for Relay to launch on Robinhood Chain…')

      const check = quote.steps[0].items[0].check
      for (let i = 0; i < 45; i++) {
        await sleep(2000)
        const st = await fetch(RELAY + check.endpoint).then((r) => r.json())
        if (st.status === 'success') {
          const dst = st.txHashes?.[0]
          setStatus('🚀 Launched! ' + (dst ? '' : 'Check the feed shortly.')); setStatusCls('hl-ok')
          if (dst) window.open(EXPLORER + '/tx/' + dst, '_blank')
          return
        }
        if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status + ' — SOL refunded if deducted.')
      }
      setStatus('Still filling — check relay.link with your wallet.')
    } catch (e) { setStatus(e.message || String(e)); setStatusCls('hl-err') }
  }

  return (
    <div className="main">
      <main className="hl-main">
        <section className="hl-card">
          <div className="hl-head"><h2 className="hl-title">Launch a coin</h2><span className="hl-pill">LIVE</span></div>
          <p className="hl-sub">Deploy on Robinhood Chain — pay straight from your Solana wallet</p>

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

          <div className="hl-fee">LP locked forever · fees claimable as SOL · Est. bridge time: <b>~2s</b></div>
          <button className="hl-cta" onClick={launch}>{authenticated ? 'Launch Coin' : 'Log in to Launch'}</button>
          <div className={'hl-status ' + statusCls}>{status}</div>
        </section>
        <aside className="hl-side">
          <div className="hl-sidebox"><h3>Required</h3><ul><li>Coin name &amp; ticker</li><li>Logo image</li></ul><h4>Optional</h4><ul><li>Description &amp; socials</li><li>Initial buy (SOL)</li></ul></div>
          <div className="hl-sidebox hl-sidebox-gold"><h3>How it works</h3><ol><li>Fill in your coin details</li><li>Sign one SOL transaction with Phantom</li><li>Relay launches it on Robinhood Chain (~2s)</li><li>LP locked forever, trades instantly</li><li>Claim your creator fees as SOL</li></ol></div>
        </aside>
      </main>
    </div>
  )
}
