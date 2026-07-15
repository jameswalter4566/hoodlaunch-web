import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { createChart } from 'lightweight-charts'
import { Connection, Transaction, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { API, RELAY, EXPLORER, usd, fmtAge, ethUsd, shortAddr } from '../api'
import MarketSwitcher from '../components/MarketSwitcher.jsx'

const SOLANA_RPC = API + '/api/solana-rpc'
const hexToBytes = (hex) => { const h = hex.replace(/^0x/, ''); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const priceUsd = (eth, e) => (!e ? eth.toExponential(3) : (eth * e >= 0.01 ? '$' + (eth * e).toFixed(4) : '$' + (eth * e).toExponential(2)))
// socials come from IPFS metadata as full URLs or bare handles — normalize both
const normUrl = (v, kind) => {
  if (!v) return null
  let s = String(v).trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  s = s.replace(/^@/, '')
  if (kind === 'twitter') return 'https://x.com/' + s
  if (kind === 'telegram') return 'https://t.me/' + s
  return 'https://' + s
}

export default function Token({ auth }) {
  const { address } = useParams()
  const [token, setToken] = useState(null)
  const [trades, setTrades] = useState([])
  const [eth, setEth] = useState(0)
  const [side, setSide] = useState('buy')
  const [amt, setAmt] = useState('')
  const [status, setStatus] = useState('')
  const [board, setBoard] = useState({ new: [], graduating: [], graduated: [] })
  const [listTab, setListTab] = useState('new')
  const [market, setMarket] = useState(localStorage.getItem('pl-market') || 'robinhood')

  useEffect(() => {
    let alive = true
    const load = () => fetch(API + '/api/board').then((r) => r.json()).then((d) => alive && setBoard(d))
    load(); const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [])
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const chartApiRef = useRef(null)

  useEffect(() => {
    let alive = true
    async function load() {
      const [tk, tr, e] = await Promise.all([
        fetch(API + '/api/tokens/' + address).then((r) => (r.ok ? r.json() : null)),
        fetch(API + '/api/tokens/' + address + '/trades?limit=100').then((r) => r.json()),
        ethUsd(),
      ])
      if (!alive) return
      setToken(tk); setTrades(tr); setEth(e)
    }
    load(); const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [address])

  // Create the chart once the token has loaded and the container div is mounted.
  // (Depending on [token], not [], because on first render token is null and the
  // chart div isn't rendered yet — so an []-effect would never create it.)
  useEffect(() => {
    if (!token || !chartRef.current || seriesRef.current) return
    const chart = createChart(chartRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#9899a3', fontFamily: 'Manrope' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      // fixed barSpacing = consistent candle width/gap everywhere (Axiom-like),
      // independent of how many candles a token has.
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
      const data = rows
        .map((r) => ({ time: Number(r.t), open: r.o * (eth || 1), high: r.h * (eth || 1), low: r.l * (eth || 1), close: r.c * (eth || 1) }))
        .sort((a, b) => a.time - b.time)
      seriesRef.current.setData(data)
      chartApiRef.current?.timeScale().scrollToRealTime()
    })
  }, [address, eth, token])

  async function buy() {
    try {
      if (!auth.authenticated) return auth.login()
      const usdAmt = parseFloat(amt); if (!(usdAmt > 0)) throw new Error('Enter an amount')
      // tokens are delivered to the user's silent embedded EVM wallet (they hold +
      // later sell from it — no MetaMask, no network switching).
      const evm = auth.evmAddress
      if (!evm) throw new Error('Your trading wallet is still setting up — try again in a moment')
      const sol = await fetch('https://api.coinbase.com/v2/prices/SOL-USD/spot').then((r) => r.json()).then((x) => Number(x.data.amount))
      const lamports = Math.floor((usdAmt / sol) * 1e9)
      setStatus('Getting quote…')
      const q = await fetch(API + '/api/quote/buy?token=' + address + '&lamports=' + lamports + '&solanaAddress=' + auth.solana + '&evmRecipient=' + evm).then((r) => r.json())
      if (!q.steps) throw new Error(q.message || 'Quote failed')
      setStatus('Sign in Phantom…')
      const conn = new Connection(SOLANA_RPC); const tx = new Transaction()
      q.steps.forEach((s) => s.items.forEach((it) => (it.data.instructions || []).forEach((ins) => tx.add(new TransactionInstruction({ programId: new PublicKey(ins.programId), keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: hexToBytes(ins.data) })))))
      tx.feePayer = new PublicKey(auth.solana); tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
      const sent = await auth.primaryWallet.sendTransaction(tx, conn)
      setStatus('Sent (' + sent.slice(0, 8) + '…) — filling…')
      const check = q.steps[0].items[0].check
      for (let i = 0; i < 45; i++) { await sleep(2000); const st = await fetch(RELAY + check.endpoint).then((r) => r.json()); if (st.status === 'success') { setStatus('✅ Bought ' + token.symbol + '!'); return } if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status) }
      setStatus('Still filling — check relay.link')
    } catch (e) { setStatus(e.message || String(e)) }
  }

  if (!token) return <div className="main tk-wrap"><div style={{ padding: 40, color: '#9899a3' }}>Loading…</div></div>

  const day = trades.filter((t) => Date.now() - new Date(t.ts).getTime() < 86400e3)
  const buys = day.filter((t) => t.side === 'buy'); const sells = day.filter((t) => t.side === 'sell')

  const listItems = market === 'solana' ? [] : (board[listTab] || [])

  return (
    <div className="main tk-wrap">
      <div className="tk-topbar">
        <div className="tk-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
          <input placeholder="Search for tokens..." />
        </div>
      </div>
      <div className="tk-layout" style={{ paddingTop: 12 }}>
        <aside className="tk-list">
          <div className="tk-list-mkt"><MarketSwitcher onChange={setMarket} /></div>
          <div className="tk-list-tabs">
            {['new', 'graduating', 'graduated'].map((b) => (
              <button key={b} className={'tk-list-tab' + (listTab === b ? ' on' : '')} onClick={() => setListTab(b)}>{b[0].toUpperCase() + b.slice(1)}</button>
            ))}
          </div>
          <div className="tk-list-body">
            {market === 'solana'
              ? <div className="tk-chart-empty" style={{ position: 'static', padding: '40px 0' }}>Solana — coming soon</div>
              : listItems.map((t) => (
                <Link key={t.address} className={'tk-row' + (t.address === address ? ' on' : '')} to={'/coin/' + t.address}>
                  <div className="tk-row-img">{t.image_url ? <img src={t.image_url} onError={(e) => e.target.remove()} /> : (t.symbol || '?')[0].toUpperCase()}</div>
                  <div className="tk-row-main"><div className="tk-row-sym">{t.symbol}</div><div className="tk-row-price">{usd(t.marketCapEth, eth)}</div></div>
                  <div className="tk-row-right"><div className="tk-row-mc">{usd(t.marketCapEth, eth)} <span style={{ color: 'var(--txt3)', fontWeight: 500, fontSize: '10.5px' }}>MC</span></div><div className={'tk-row-chg ' + ((t.priceChange24h || 0) > 0 ? 'up' : (t.priceChange24h || 0) < 0 ? 'down' : '')}>{(t.priceChange24h || 0).toFixed(2)}%</div></div>
                </Link>
              ))}
          </div>
        </aside>
        <section className="tk-center">
          <div className="tk-head">
            <div className="tk-head-id">
              <div className="tk-head-img">{token.image_url ? <img src={token.image_url} alt="" onError={(e) => e.target.remove()} /> : (token.symbol || '?')[0].toUpperCase()}</div>
              <div><div className="tk-head-sym">{token.symbol}</div><div className="tk-head-name">{token.name}</div></div>
              <span className="tk-head-ca" onClick={() => navigator.clipboard.writeText(address)}>{shortAddr(address)} ⧉</span>
              {token.socials && (token.socials.website || token.socials.twitter || token.socials.telegram) && (
                <div className="tk-head-socials">
                  {token.socials.website && <a href={normUrl(token.socials.website, 'website')} target="_blank" rel="noopener">🌐 Website</a>}
                  {token.socials.twitter && <a href={normUrl(token.socials.twitter, 'twitter')} target="_blank" rel="noopener">𝕏 Twitter</a>}
                  {token.socials.telegram && <a href={normUrl(token.socials.telegram, 'telegram')} target="_blank" rel="noopener">✈ Telegram</a>}
                </div>
              )}
            </div>
            <div className="tk-stats">
              <div className="tk-stat"><span>Market cap</span><b className="big">{usd(token.marketCapEth, eth)}</b></div>
              <div className="tk-stat"><span>Price</span><b>{priceUsd(token.priceEth, eth)}</b></div>
              <div className="tk-stat"><span>24H change</span><b className={token.priceChange24h > 0 ? 'up' : 'down'}>{token.priceChange24h > 0 ? '+' : ''}{(token.priceChange24h || 0).toFixed(2)}%</b></div>
              <div className="tk-stat"><span>Holders</span><b>{token.holders}</b></div>
              <div className="tk-stat"><span>Graduation</span><b>{Math.round(token.graduationPct || 0)}%</b></div>
            </div>
          </div>
          <div className="tk-chart" ref={chartRef} style={{ flex: 1, minHeight: 300 }} />
          <div className="tk-tabs"><button className="tk-tab on">Swaps</button></div>
          <div className="tk-table-wrap">
            <table className="tk-table">
              <thead><tr><th>Time</th><th>Side</th><th>USD</th><th>Tokens</th><th>Trader</th><th>Tx</th></tr></thead>
              <tbody>{trades.slice(0, 60).map((tr) => (
                <tr key={tr.tx_hash + tr.log_index}><td>{fmtAge(tr.ts)}</td><td className={'side-' + tr.side}>{tr.side.toUpperCase()}</td><td><b>{usd(Number(tr.eth_amount), eth)}</b></td><td>{Number(tr.token_amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td><td>{shortAddr(tr.trader)}</td><td><a href={EXPLORER + '/tx/' + tr.tx_hash} target="_blank" rel="noopener">↗</a></td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
        <aside className="tk-trade">
          <div className="tk-bs">
            <button className={'buy' + (side === 'buy' ? ' on' : '')} onClick={() => setSide('buy')}>Buy</button>
            <button className={'sell' + (side === 'sell' ? ' on' : '')} onClick={() => setSide('sell')}>Sell</button>
          </div>
          <div className="tk-amount"><input type="number" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="$0" /><span>USD in SOL</span></div>
          {side === 'buy' && <div className="tk-presets">{[10, 100, 500, 1000].map((v) => <button key={v} onClick={() => setAmt(String(v))}>${v}</button>)}</div>}
          <button className={'tk-cta' + (side === 'sell' ? ' sellmode' : '')} onClick={buy}>{!auth.authenticated ? 'Log in' : side === 'buy' ? 'Buy ' + token.symbol : 'Sell ' + token.symbol}</button>
          <div className="tk-status">{status}</div>
          <div className="tk-about"><h3>About {token.symbol}</h3><p>{token.description || 'No description.'}</p></div>
          <div className="tk-flow">
            <div className="tk-flow-row"><b className="g">{buys.length} buys</b><b className="r">{sells.length} sells</b></div>
            <div className="tk-bar"><i className="g" style={{ width: (day.length ? (buys.length / day.length) * 100 : 50) + '%' }} /><i className="r" style={{ flex: 1 }} /></div>
          </div>
        </aside>
      </div>
    </div>
  )
}
