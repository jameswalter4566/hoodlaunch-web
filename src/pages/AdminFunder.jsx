import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminGate from '../components/AdminGate.jsx'
import * as B from '../lib/bundler.js'
import '../bundler.css'

export default function AdminFunder({ auth }) {
  return <AdminGate><Funder auth={auth} /></AdminGate>
}

function Funder() {
  const [funders, setFunders] = useState(B.loadFunders)
  const [targets, setTargets] = useState(B.loadTargets)
  const [solBal, setSolBal] = useState({}) // funder id -> SOL
  const [ethBal, setEthBal] = useState({}) // target id -> ETH
  const [busy, setBusy] = useState({}) // target id -> 'funding'|'ok'|'fail'
  const [status, setStatus] = useState('')
  const [fImport, setFImport] = useState('')
  const [tImport, setTImport] = useState('')
  const [masterId, setMasterId] = useState('')
  const [perAmount, setPerAmount] = useState('0.05')
  const [jitter, setJitter] = useState(true)
  const [funding, setFunding] = useState(false)

  const saveF = (x) => { setFunders(x); B.saveFunders(x) }
  const saveT = (x) => { setTargets(x); B.saveTargets(x) }
  const flash = (m) => { setStatus(m); setTimeout(() => setStatus(''), 6000) }
  const copy = (t) => navigator.clipboard.writeText(t).catch(() => {})

  const refresh = useCallback(async () => {
    const F = B.loadFunders(), T = B.loadTargets()
    const s = {}, e = {}
    await Promise.all([
      ...F.map(async (f) => { s[f.id] = await B.solBalance(f.pubkey) }),
      ...T.map(async (t) => { e[t.id] = await B.evmEthBalance(t.address) }),
    ])
    setSolBal(s); setEthBal(e)
  }, [])
  useEffect(() => { refresh(); const i = setInterval(refresh, 15000); return () => clearInterval(i) }, [refresh])

  // ---- funders ----
  const addFunder = () => saveF([...funders, B.newFunder()])
  const importFunder = () => {
    const added = []
    for (const l of fImport.split('\n').map((x) => x.trim()).filter(Boolean)) { try { const f = B.importFunder(l); if (!funders.some((x) => x.id === f.id) && !added.some((x) => x.id === f.id)) added.push(f) } catch { /* skip */ } }
    if (!added.length) return flash('No valid Solana keys')
    saveF([...funders, ...added]); setFImport(''); flash('Imported ' + added.length + ' funder(s)')
  }
  const removeFunder = (id) => saveF(funders.filter((f) => f.id !== id))

  // ---- EVM targets ----
  const addTarget = () => saveT([...targets, B.newEvmTarget()])
  const importTargets = () => {
    const added = []
    for (const l of tImport.split('\n').map((x) => x.trim()).filter(Boolean)) { try { const t = B.importEvmTarget(l); if (!targets.some((x) => x.id === t.id) && !added.some((x) => x.id === t.id)) added.push(t) } catch { /* skip */ } }
    if (!added.length) return flash('No valid EVM addresses/keys')
    saveT([...targets, ...added]); setTImport(''); flash('Imported ' + added.length + ' wallet(s)')
  }
  const removeTarget = (id) => saveT(targets.filter((t) => t.id !== id))
  const setField = (id, k, v) => saveT(targets.map((t) => (t.id === id ? { ...t, [k]: v } : t)))

  // pair funder i -> target i (each EVM wallet gets its own dedicated funder = no shared source)
  const autoPair = () => saveT(targets.map((t, i) => ({ ...t, funderId: funders[i]?.id || '' })))

  async function fundOne(t) {
    const funder = funders.find((f) => f.id === t.funderId)
    if (!funder) return flash('Assign a funder to ' + B.short(t.address))
    if (!(Number(t.amount) > 0)) return flash('Set a SOL amount for ' + B.short(t.address))
    setBusy((b) => ({ ...b, [t.id]: 'funding' }))
    try { await B.fundEvm(funder, t.address, t.amount); setBusy((b) => ({ ...b, [t.id]: 'ok' })); flash('✅ Funded ' + B.short(t.address)) }
    catch (e) { setBusy((b) => ({ ...b, [t.id]: 'fail' })); flash('⚠️ ' + B.short(t.address) + ': ' + (e.message || e)) }
    refresh()
  }
  async function fundAll() {
    const list = B.loadTargets().filter((t) => Number(t.amount) > 0 && t.funderId)
    if (!list.length) return flash('Set amounts + funders first (try Auto-pair)')
    flash('Bridging SOL → ETH to ' + list.length + ' wallets…')
    // slight random stagger so the bridges aren't identical-timestamp (extra unlinkability)
    await Promise.all(list.map((t) => new Promise((r) => setTimeout(r, Math.random() * 1500)).then(() => fundOne(t))))
    flash('Done funding ' + list.length + ' wallets')
  }

  // MASTER MODE: fund ONE Solana wallet from Coinbase, then bridge from it to EVERY
  // EVM wallet. They stay unlinked on Robinhood Chain (Relay solver is the on-chain
  // funder). Sent one at a time (a single wallet can't sign in parallel) with jittered
  // amounts + random stagger so the batch isn't correlatable across chains.
  async function fundAllFromMaster() {
    const master = funders.find((f) => f.id === masterId) || funders[0]
    if (!master) return flash('Create a master funder first (and fund it from Coinbase)')
    const per = Number(perAmount)
    if (!(per > 0)) return flash('Set SOL per wallet')
    const list = B.loadTargets()
    if (!list.length) return flash('Add EVM wallets first')
    setFunding(true)
    let ok = 0
    for (let i = 0; i < list.length; i++) {
      const t = list[i]
      const amt = (jitter ? per * (0.85 + Math.random() * 0.3) : per).toFixed(4)
      flash('Bridging ' + (i + 1) + '/' + list.length + ' → ' + B.short(t.address) + ' (' + amt + ' SOL)…')
      setBusy((b) => ({ ...b, [t.id]: 'funding' }))
      try { await B.fundEvm(master, t.address, amt); setBusy((b) => ({ ...b, [t.id]: 'ok' })); ok++ }
      catch (e) { setBusy((b) => ({ ...b, [t.id]: 'fail' })); flash('⚠️ ' + B.short(t.address) + ': ' + (e.message || e)) }
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 900))
    }
    setFunding(false)
    flash('✅ Funded ' + ok + '/' + list.length + ' wallets from master ' + B.short(master.pubkey))
    refresh()
  }

  return (
    <div className="main fn">
      <div className="fn-head">
        <Link className="bn-ghost" to="/admin">← Admin</Link>
        <h1>Wallet Funder</h1>
        <span className="fn-sub">Bridge SOL → ETH so each EVM wallet lands funded by the Relay solver — unlinked on Robinhood Chain.</span>
        <button className="bn-ghost" onClick={refresh} style={{ marginLeft: 'auto' }}>↻ Refresh</button>
      </div>

      {/* MASTER: fund one wallet from Coinbase, bridge to all — the simple path */}
      <div className="fn-master">
        <div className="fn-master-l">
          <span className="fn-master-tag">1-CLICK</span>
          <span className="fn-master-txt">Fund <b>one</b> master from Coinbase, bridge to <b>every</b> EVM wallet. Stays unclustered on Robinhood Chain.</span>
        </div>
        <div className="fn-master-r">
          <select value={masterId} onChange={(e) => setMasterId(e.target.value)} title="Master funder (fund this one from Coinbase)">
            <option value="">master: #1 {funders[0] ? B.short(funders[0].pubkey) : '(create a funder)'}</option>
            {funders.map((f, i) => <option key={f.id} value={f.id}>master: #{i + 1} {B.short(f.pubkey)}</option>)}
          </select>
          <input type="number" min="0" step="0.01" value={perAmount} onChange={(e) => setPerAmount(e.target.value)} title="SOL per wallet" />
          <span className="fn-master-unit">SOL/wallet</span>
          <label className="fn-master-jit"><input type="checkbox" checked={jitter} onChange={(e) => setJitter(e.target.checked)} /> jitter</label>
          <button className="fn-fundall" style={{ width: 'auto', margin: 0 }} disabled={funding} onClick={fundAllFromMaster}>
            {funding ? 'Bridging…' : '⇩ Fund all ' + targets.length + ' wallets'}
          </button>
        </div>
      </div>

      <div className="fn-grid">
        {/* Solana funders */}
        <section className="fn-panel">
          <div className="fn-panel-h">
            <h2>Solana funders <span>{funders.length}</span></h2>
            <button className="bn-tool" onClick={addFunder}>+ Create funder</button>
          </div>
          <p className="fn-note">Fund each of these with SOL from a CEX (Coinbase supports SOL). Give each its own source so they're not linked.</p>
          <div className="fn-import">
            <textarea value={fImport} onChange={(e) => setFImport(e.target.value)} placeholder="Import Solana keys (base58 or [1,2,…]) — one per line" rows={2} />
            <button className="bn-tool" onClick={importFunder}>Import</button>
          </div>
          <div className="fn-rows">
            {funders.map((f, i) => (
              <div className="fn-row" key={f.id}>
                <span className="fn-idx">{i + 1}</span>
                <button className="bn-copy" title="Copy address — fund with SOL from Coinbase" onClick={() => copy(f.pubkey)}>⧉ {B.short(f.pubkey)}</button>
                <span className="fn-bal"><b>{solBal[f.id] == null ? '…' : solBal[f.id].toFixed(3)}</b> SOL</span>
                <div className="bn-actions">
                  <button title="Copy private key" onClick={() => copy(f.secret)}>🔑</button>
                  <button title="Remove" onClick={() => removeFunder(f.id)}>✕</button>
                </div>
              </div>
            ))}
            {!funders.length && <div className="fn-empty">No funders yet — create or import Solana wallets to pay for the bridges.</div>}
          </div>
        </section>

        {/* EVM wallets to fund */}
        <section className="fn-panel">
          <div className="fn-panel-h">
            <h2>EVM wallets <span>{targets.length}</span></h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="bn-tool" onClick={autoPair} title="Assign funder #i to wallet #i (dedicated source each)">Auto-pair 1:1</button>
              <button className="bn-tool" onClick={addTarget}>+ New</button>
            </div>
          </div>
          <p className="fn-note">Import the wallets you want to fund (address, or private key if you'll also trade from them), or generate fresh ones.</p>
          <div className="fn-import">
            <textarea value={tImport} onChange={(e) => setTImport(e.target.value)} placeholder="Import EVM wallets — address (0x…40) or private key (0x…64), one per line" rows={2} />
            <button className="bn-tool" onClick={importTargets}>Import</button>
          </div>
          <div className="fn-rows">
            {targets.map((t) => (
              <div className={'fn-row wide' + (busy[t.id] === 'ok' ? ' ok' : busy[t.id] === 'fail' ? ' fail' : busy[t.id] === 'funding' ? ' busy' : '')} key={t.id}>
                <button className="bn-copy" title="Copy address" onClick={() => copy(t.address)}>⧉ {B.short(t.address)}</button>
                <span className="fn-bal"><b>{ethBal[t.id] == null ? '…' : ethBal[t.id].toFixed(4)}</b> ETH</span>
                <input className="fn-amt" type="number" min="0" step="0.01" value={t.amount || ''} onChange={(e) => setField(t.id, 'amount', e.target.value)} placeholder="SOL" />
                <select className="fn-sel" value={t.funderId || ''} onChange={(e) => setField(t.id, 'funderId', e.target.value)}>
                  <option value="">funder…</option>
                  {funders.map((f, i) => <option key={f.id} value={f.id}>#{i + 1} {B.short(f.pubkey)}</option>)}
                </select>
                <button className="bn-tool green" disabled={busy[t.id] === 'funding'} onClick={() => fundOne(t)}>Fund</button>
                <div className="bn-actions">
                  {t.pk && <button title="Copy private key" onClick={() => copy(t.pk)}>🔑</button>}
                  <button title="Remove" onClick={() => removeTarget(t.id)}>✕</button>
                </div>
              </div>
            ))}
            {!targets.length && <div className="fn-empty">No wallets yet — import or generate the EVM wallets to fund.</div>}
          </div>
          <button className="fn-fundall" onClick={fundAll}>⇩ Fund all (SOL → ETH via Relay)</button>
        </section>
      </div>

      {status && <div className="fn-status">{status}</div>}
    </div>
  )
}
