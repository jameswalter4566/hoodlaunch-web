import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { createChart } from 'lightweight-charts'
import { API, EXPLORER, usd, fmtAge, ethUsd, shortAddr } from '../api'
import AdminGate from '../components/AdminGate.jsx'
import * as B from '../lib/bundler.js'
import '../bundler.css'

const priceUsd = (eth, e) => (!e || !eth ? '—' : eth * e >= 0.01 ? '$' + (eth * e).toFixed(4) : '$' + (eth * e).toExponential(2))

export default function AdminBundler({ auth }) {
  return <AdminGate><Bundler auth={auth} /></AdminGate>
}

function Bundler({ auth }) {
  const { address } = useParams()
  const [token, setToken] = useState(null)
  const [trades, setTrades] = useState([])
  const [eth, setEth] = useState(0)
  const [slots, setSlots] = useState(B.loadSlots)
  const [bals, setBals] = useState({}) // id -> { sol, tokens, supplyPct, ethBal }
  const [devBal, setDevBal] = useState({ tokens: 0, supplyPct: 0 })
  const [busy, setBusy] = useState({}) // id -> 'buying' | 'selling'
  const [status, setStatus] = useState('')
  const [side, setSide] = useState('buy')
  const [aggSol, setAggSol] = useState('0.1') // SOL per wallet for aggregate buy
  const [aggPct, setAggPct] = useState('100') // % for aggregate sell
  const [createN, setCreateN] = useState('5')
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [fundSol, setFundSol] = useState('0.1')
  const [withdrawAddr, setWithdrawAddr] = useState('')

  // default the withdraw destination to the connected Phantom (editable)
  useEffect(() => { if (auth.solana) setWithdrawAddr((a) => a || auth.solana) }, [auth.solana])

  const persist = (next) => { setSlots(next); B.saveSlots(next) }

  // ---- token + trades + chart (mirrors Token.jsx) ----
  useEffect(() => {
    let alive = true
    const load = async () => {
      const [tk, tr, e] = await Promise.all([
        fetch(API + '/api/tokens/' + address).then((r) => (r.ok ? r.json() : null)),
        fetch(API + '/api/tokens/' + address + '/trades?limit=100').then((r) => r.json()).catch(() => []),
        ethUsd(),
      ])
      if (!alive) return
      setToken(tk); setTrades(Array.isArray(tr) ? tr : []); setEth(e)
    }
    load(); const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [address])

  const chartRef = useRef(null), seriesRef = useRef(null), chartApiRef = useRef(null)
  useEffect(() => {
    if (!token || !chartRef.current || seriesRef.current) return
    const chart = createChart(chartRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#9899a3', fontFamily: 'Manrope' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      timeScale: { timeVisible: true, borderColor: '#1f1e2c', barSpacing: 7, minBarSpacing: 4, rightOffset: 6 },
      rightPriceScale: { borderColor: '#1f1e2c' }, autoSize: true,
    })
    chartApiRef.current = chart
    seriesRef.current = chart.addCandlestickSeries({ upColor: '#21c95e', downColor: '#f6465d', wickUpColor: '#21c95e', wickDownColor: '#f6465d', borderVisible: false, priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 } })
  }, [token])
  useEffect(() => {
    if (!seriesRef.current) return
    fetch(API + '/api/tokens/' + address + '/candles?interval=300&limit=300').then((r) => r.json()).then((rows) => {
      if (!Array.isArray(rows) || !rows.length) return
      seriesRef.current.setData(rows.map((r) => ({ time: Number(r.t), open: r.o * (eth || 1), high: r.h * (eth || 1), low: r.l * (eth || 1), close: r.c * (eth || 1) })).sort((a, b) => a.time - b.time))
      chartApiRef.current?.timeScale().scrollToRealTime()
    }).catch(() => {})
  }, [address, eth, token])

  // ---- balances (SOL buyer + token holder per slot, + dev wallet) ----
  const refresh = useCallback(async () => {
    const cur = B.loadSlots()
    setBals(await B.walletStates(address, cur))
    if (auth.evmAddress) { const d = await B.tokenState(address, auth.evmAddress); setDevBal({ tokens: d.tokens || 0, supplyPct: d.supplyPct || 0 }) }
  }, [address, auth.evmAddress])
  useEffect(() => { refresh(); const i = setInterval(refresh, 15000); return () => clearInterval(i) }, [refresh])

  // ---- actions ----
  const flash = (m) => { setStatus(m); setTimeout(() => setStatus(''), 6000) }
  const mark = (id, v) => setBusy((b) => ({ ...b, [id]: v }))

  async function doBuy(slot, solAmount) {
    mark(slot.id, 'buying')
    try { await B.buy(slot, address, solAmount); flash('✅ ' + B.short(slot.evmAddress) + ' bought') }
    catch (e) { flash('⚠️ Buy ' + B.short(slot.evmAddress) + ': ' + (e.message || e)) }
    mark(slot.id, null); refresh()
  }
  async function doBuyPct(slot, pct) {
    mark(slot.id, 'buying')
    try { await B.buyPct(slot, address, pct); flash('✅ ' + B.short(slot.evmAddress) + ' bought') }
    catch (e) { flash('⚠️ Buy ' + B.short(slot.evmAddress) + ': ' + (e.message || e)) }
    mark(slot.id, null); refresh()
  }
  async function doSell(slot, pct) {
    mark(slot.id, 'selling')
    try { await B.sellPct(slot, address, pct); flash('✅ ' + B.short(slot.evmAddress) + ' sold ' + pct + '%') }
    catch (e) { flash('⚠️ Sell ' + B.short(slot.evmAddress) + ': ' + (e.message || e)) }
    mark(slot.id, null); refresh()
  }
  async function doSellDev(pct) {
    mark('dev', 'selling')
    try { await B.sellDev(auth, address, pct); flash('✅ Dev sold ' + pct + '%') }
    catch (e) { flash('⚠️ Dev sell: ' + (e.message || e)) }
    mark('dev', null); refresh()
  }
  async function doBridge(slot) {
    mark(slot.id, 'bridging')
    try { await B.bridgeEvmToSol(slot); flash('✅ Bridged ' + B.short(slot.evmAddress) + ' ETH → SOL') }
    catch (e) { flash('⚠️ Bridge ' + B.short(slot.evmAddress) + ': ' + (e.message || e)) }
    mark(slot.id, null); refresh()
  }
  async function bridgeAll() {
    const list = B.loadSlots()
    if (!list.length) return
    flash('Bridging ETH → SOL on ' + list.length + ' wallets…')
    for (const s of list) await doBridge(s) // serial — each is a cross-chain fill
    flash('Bridged all wallets · ETH → SOL')
  }

  // aggregate buy — fire every wallet AT ONCE (independent Solana wallets, safe parallel)
  function buyAll(solAmount) {
    const list = B.loadSlots()
    if (!list.length) return flash('No wallets — create some first')
    flash('Buying from ' + list.length + ' wallets…')
    list.forEach((s) => doBuy(s, solAmount))
  }
  // Sells are serialized on purpose: each one triggers a gas top-up from the single
  // treasury wallet, so firing them in parallel would collide on the treasury nonce.
  async function sellAll(pct) {
    const list = B.loadSlots()
    if (!list.length) return
    flash('Selling ' + pct + '% from ' + list.length + ' wallets…')
    for (const s of list) await doSell(s, pct)
    flash('Done selling ' + pct + '% across ' + list.length + ' wallets')
  }
  async function nuke() {
    if (!confirm('Nuke — sell 100% of every bundle wallet AND the dev wallet?')) return
    await sellAll(100)
    if (auth.evmAddress) await doSellDev(100)
  }

  // wallet management
  const createWallets = () => { const n = Math.max(1, Math.min(100, parseInt(createN) || 1)); persist([...slots, ...Array.from({ length: n }, () => B.newSlot())]) }
  const importWallets = () => {
    const lines = importText.split('\n').map((l) => l.trim()).filter(Boolean)
    const added = []
    for (const l of lines) { try { const s = B.importSlot(l); if (!slots.some((x) => x.id === s.id) && !added.some((x) => x.id === s.id)) added.push(s) } catch { /* skip bad line */ } }
    if (!added.length) return flash('No valid Solana keys found')
    persist([...slots, ...added]); setImportText(''); setShowImport(false); flash('Imported ' + added.length + ' wallet(s)')
  }
  const removeSlot = (id) => { if (confirm('Remove this wallet from the bundle? (its keys are only stored here)')) persist(slots.filter((s) => s.id !== id)) }
  const copy = (t) => navigator.clipboard.writeText(t).catch(() => {})
  const exportKeys = (s) => { copy(JSON.stringify({ solana: s.solSecret, evm: s.evmPk, evmAddress: s.evmAddress }, null, 2)); flash('Keys copied for ' + B.short(s.evmAddress)) }

  async function fundAll() {
    const per = Number(fundSol)
    if (!(per > 0)) return flash('Enter a SOL amount per wallet')
    if (!auth.authenticated) return auth.login()
    try { await B.fundWallets(auth, slots.map((s) => ({ pubkey: s.solPubkey, sol: per }))); flash('Funded ' + slots.length + ' wallets · ' + per + ' SOL each'); setTimeout(refresh, 4000) }
    catch (e) { flash('⚠️ Fund: ' + (e.message || e)) }
  }
  async function withdrawAll() {
    const dest = (withdrawAddr || '').trim()
    if (!B.isSolAddress(dest)) return flash('Enter a valid destination SOL address')
    if (!confirm('Sweep ALL SOL from every wallet to ' + dest + ' ?')) return
    let n = 0
    for (const s of B.loadSlots()) { try { if (await B.sweepSol(s, dest)) n++ } catch { /* skip empty */ } }
    flash('Swept ' + n + ' wallets → ' + B.short(dest)); setTimeout(refresh, 4000)
  }

  // ---- derived ----
  const day = trades.filter((t) => Date.now() - new Date(t.ts).getTime() < 86400e3)
  const buys = day.filter((t) => t.side === 'buy'), sells = day.filter((t) => t.side === 'sell')
  const totSupplyPct = slots.reduce((a, s) => a + (bals[s.id]?.supplyPct || 0), 0) + (devBal.supplyPct || 0)
  const totSol = slots.reduce((a, s) => a + (bals[s.id]?.sol || 0), 0)
  const totEth = slots.reduce((a, s) => a + (bals[s.id]?.ethBal || 0), 0)
  const totTokens = slots.reduce((a, s) => a + (bals[s.id]?.tokens || 0), 0) + (devBal.tokens || 0)
  const holdingEth = token ? totTokens * (token.priceEth || 0) : 0
  const busyCount = Object.values(busy).filter(Boolean).length

  if (!token) return <div className="main" style={{ padding: 40, color: 'var(--txt2)' }}>Loading {shortAddr(address)}…</div>

  const BuyPresets = ({ s }) => (
    <div className="bn-presets buy">{[25, 50, 75, 100].map((p) => <button key={p} disabled={busy[s.id]} onClick={() => doBuyPct(s, p)}>{p}%</button>)}</div>
  )
  const SellPresets = ({ s }) => (
    <div className="bn-presets sell">{[25, 50, 75, 100].map((p) => <button key={p} disabled={busy[s.id]} onClick={() => doSell(s, p)}>{p}%</button>)}</div>
  )

  return (
    <div className="main bn">
      {/* top bar */}
      <div className="bn-top">
        <div className="bn-top-id">
          <div className="bn-top-img">{token.image_url ? <img src={token.image_url} alt="" onError={(e) => e.target.remove()} /> : (token.symbol || '?')[0].toUpperCase()}</div>
          <div>
            <div className="bn-top-sym">${token.symbol} <span className="bn-badge">BUNDLER</span></div>
            <button className="bn-top-ca" onClick={() => copy(address)}>{shortAddr(address)} ⧉</button>
          </div>
        </div>
        <div className="bn-top-stats">
          <div><span>Mcap</span><b>{usd(token.marketCapEth, eth)}</b></div>
          <div><span>Price</span><b>{priceUsd(token.priceEth, eth)}</b></div>
          <div><span>Holders</span><b>{token.holders ?? 0}</b></div>
          <div><span>Buys 24h</span><b className="up">{buys.length}</b></div>
          <div><span>Sells 24h</span><b className="down">{sells.length}</b></div>
        </div>
        <div className="bn-top-r">
          <Link className="bn-ghost" to={'/coin/' + address}>Public page ↗</Link>
          <button className="bn-ghost" onClick={bridgeAll} title="Bridge every wallet's ETH back to SOL">Bridge all → SOL</button>
          <input className="bn-wdaddr" value={withdrawAddr} onChange={(e) => setWithdrawAddr(e.target.value)} placeholder="Withdraw SOL to… (address)" />
          <button className="bn-wd" onClick={withdrawAll} title="Sweep all SOL from every wallet to the address">Withdraw all SOL</button>
        </div>
      </div>

      <div className="bn-mid">
        {/* chart */}
        <section className="bn-chart-wrap">
          <div className="bn-chart" ref={chartRef} />
          <div className="bn-swaps">
            <div className="bn-swaps-h">Latest trades</div>
            <table className="bn-swaps-t"><thead><tr><th>Time</th><th>Side</th><th>USD</th><th>Trader</th><th></th></tr></thead>
              <tbody>{trades.slice(0, 12).map((tr) => {
                const mine = slots.some((s) => s.evmAddress.toLowerCase() === (tr.trader || '').toLowerCase()) || (auth.evmAddress || '').toLowerCase() === (tr.trader || '').toLowerCase()
                return <tr key={tr.tx_hash + tr.log_index} className={mine ? 'mine' : ''}><td>{fmtAge(tr.ts)}</td><td className={'side-' + tr.side}>{tr.side.toUpperCase()}</td><td>{usd(Number(tr.eth_amount), eth)}</td><td>{shortAddr(tr.trader)}{mine && ' •'}</td><td><a href={EXPLORER + '/tx/' + tr.tx_hash} target="_blank" rel="noopener">↗</a></td></tr>
              })}</tbody>
            </table>
          </div>
        </section>

        {/* right trade panel */}
        <aside className="bn-panel">
          <div className="bn-bs">
            <button className={side === 'buy' ? 'on' : ''} onClick={() => setSide('buy')}>Buy</button>
            <button className={'sell' + (side === 'sell' ? ' on' : '')} onClick={() => setSide('sell')}>Sell</button>
          </div>

          {side === 'buy' ? (
            <>
              <div className="bn-field"><input type="number" min="0" step="0.01" value={aggSol} onChange={(e) => setAggSol(e.target.value)} /><span>SOL / wallet</span></div>
              <div className="bn-quick">{['0.05', '0.1', '0.25', '0.5'].map((v) => <button key={v} onClick={() => setAggSol(v)}>{v}</button>)}</div>
              <button className="bn-cta buy" onClick={() => buyAll(aggSol)}>Buy all wallets · {slots.length}</button>
            </>
          ) : (
            <>
              <div className="bn-field"><input type="number" min="1" max="100" value={aggPct} onChange={(e) => setAggPct(e.target.value)} /><span>% of holdings</span></div>
              <div className="bn-quick">{[25, 50, 75, 100].map((v) => <button key={v} onClick={() => setAggPct(String(v))}>{v}%</button>)}</div>
              <button className="bn-cta sell" onClick={() => sellAll(aggPct)}>Sell {aggPct}% · all wallets</button>
            </>
          )}

          <div className="bn-sec">
            <div className="bn-sec-h"><span>Holders (all wallets)</span><b>{totSupplyPct.toFixed(2)}%</b></div>
            <div className="bn-presets sell wide">{[25, 50, 75, 100].map((p) => <button key={p} onClick={() => sellAll(p)}>{p}%</button>)}</div>
          </div>
          <div className="bn-sec">
            <div className="bn-sec-h"><span>Deployer (dev wallet)</span><b>{(devBal.supplyPct || 0).toFixed(2)}%</b></div>
            <div className="bn-presets sell wide">{[25, 50, 75, 100].map((p) => <button key={p} disabled={busy.dev} onClick={() => doSellDev(p)}>{p}%</button>)}</div>
          </div>

          <div className="bn-metrics">
            <div><span>Supply held</span><b>{totSupplyPct.toFixed(2)}%</b></div>
            <div><span>Holding</span><b>{usd(holdingEth, eth)}</b></div>
            <div><span>SOL left</span><b>{totSol.toFixed(3)}</b></div>
            <div><span>ETH collected</span><b>{totEth.toFixed(4)}</b></div>
          </div>

          <button className="bn-nuke" onClick={nuke}>🔴 Nuke — sell everything</button>
          {status && <div className="bn-status">{status}</div>}
        </aside>
      </div>

      {/* bottom multi-wallet panel */}
      <div className="bn-wallets">
        <div className="bn-wallets-h">
          <div className="bn-wallets-tabs"><button className="on">My Wallets</button></div>
          <div className="bn-wallets-tools">
            <div className="bn-inline"><input type="number" min="1" max="100" value={createN} onChange={(e) => setCreateN(e.target.value)} /><button className="bn-tool" onClick={createWallets}>+ Create Wallets</button></div>
            <button className="bn-tool" onClick={() => setShowImport((v) => !v)}>Import Wallets</button>
            <div className="bn-inline"><input type="number" min="0" step="0.01" value={fundSol} onChange={(e) => setFundSol(e.target.value)} /><button className="bn-tool green" onClick={fundAll}>Fund {fundSol} SOL ea</button></div>
            <button className="bn-tool" onClick={refresh} title="Refresh balances">↻</button>
          </div>
        </div>

        {showImport && (
          <div className="bn-import">
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste Solana private keys (base58 or [1,2,…]) — one per line. A fresh EVM twin is created for each." rows={3} />
            <button className="bn-tool green" onClick={importWallets}>Import</button>
          </div>
        )}

        <div className="bn-table-wrap">
          <table className="bn-table">
            <thead><tr><th>#</th><th>Wallet (EVM)</th><th>SOL</th><th>Supply</th><th>Holding</th><th className="c">Buy</th><th className="c">Sell</th><th></th></tr></thead>
            <tbody>
              {/* Dev / deployer row */}
              <tr className="dev">
                <td>👑</td>
                <td><span className="bn-addr">{shortAddr(auth.evmAddress || '—')}</span> <span className="bn-tag">DEV</span></td>
                <td>—</td>
                <td>{(devBal.supplyPct || 0).toFixed(2)}%</td>
                <td>{token ? usd((devBal.tokens || 0) * (token.priceEth || 0), eth) : '—'}</td>
                <td className="c bn-dim">via launch</td>
                <td className="c"><div className="bn-presets sell">{[25, 50, 75, 100].map((p) => <button key={p} disabled={busy.dev || !auth.evmAddress} onClick={() => doSellDev(p)}>{p}%</button>)}</div></td>
                <td></td>
              </tr>
              {slots.map((s, i) => {
                const b = bals[s.id] || {}
                return (
                  <tr key={s.id} className={busy[s.id] ? 'busy' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      <span className="bn-addr" title={s.evmAddress}>{shortAddr(s.evmAddress)}</span>
                      <button className="bn-copy" title="Copy Solana buyer address (to fund with SOL)" onClick={() => copy(s.solPubkey)}>⧉ fund</button>
                    </td>
                    <td className={b.sol > 0 ? 'ok' : 'bn-dim'}>{b.sol == null ? '…' : b.sol.toFixed(3)}</td>
                    <td>{b.supplyPct == null ? '…' : b.supplyPct.toFixed(2) + '%'}</td>
                    <td>{b.tokens == null ? '…' : token ? usd(b.tokens * (token.priceEth || 0), eth) : '—'}</td>
                    <td className="c"><BuyPresets s={s} /></td>
                    <td className="c"><SellPresets s={s} /></td>
                    <td className="bn-actions">
                      <button title="Bridge this wallet's ETH → SOL (into its own buyer)" disabled={busy[s.id]} onClick={() => doBridge(s)}>⇄</button>
                      <button title="Export keys" onClick={() => exportKeys(s)}>🔑</button>
                      <button title="Remove" onClick={() => removeSlot(s.id)}>✕</button>
                    </td>
                  </tr>
                )
              })}
              {!slots.length && <tr><td colSpan="8" className="bn-empty">No wallets yet — set a count and hit “Create Wallets,” then “Fund … SOL ea.”</td></tr>}
            </tbody>
            <tfoot><tr><td></td><td>Total: {slots.length} wallets + dev</td><td>{totSol.toFixed(3)}</td><td>{totSupplyPct.toFixed(2)}%</td><td>{usd(holdingEth, eth)}</td><td colSpan="3">{busyCount ? busyCount + ' working…' : ''}</td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
