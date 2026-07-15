import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createChart } from 'lightweight-charts'
import { API, usd, ethUsd } from '../api'

export default function Landing({ auth }) {
  const nav = useNavigate()
  const [view, setView] = useState('markets')
  const [top, setTop] = useState([])
  const [pulse, setPulse] = useState({ newPairs: [], finalStretch: [], migrated: [] })
  const [eth, setEth] = useState(0)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetch(API + '/api/pulse').then((r) => r.json()), ethUsd()]).then(([d, e]) => {
      if (!alive) return
      setPulse(d); setEth(e)
      const all = [].concat(d.migrated, d.finalStretch, d.newPairs).sort((a, b) => b.volume24hUsd - a.volume24hUsd).slice(0, 7)
      setTop(all)
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (view !== 'markets' || !chartRef.current || seriesRef.current || !top[0]) return
    const chart = createChart(chartRef.current, { layout: { background: { color: 'transparent' }, textColor: '#9899a3', fontFamily: 'Manrope' }, grid: { vertLines: { color: '#15141f' }, horzLines: { color: '#15141f' } }, timeScale: { timeVisible: true, borderColor: '#1f1e2c' }, rightPriceScale: { borderColor: '#1f1e2c' }, autoSize: true })
    seriesRef.current = chart.addCandlestickSeries({ upColor: '#21c95e', downColor: '#f6465d', wickUpColor: '#21c95e', wickDownColor: '#f6465d', borderVisible: false, priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 } })
    fetch(API + '/api/tokens/' + top[0].token + '/candles?interval=300&limit=200').then((r) => r.json()).then((rows) => rows.length && seriesRef.current.setData(rows.reverse().map((r) => ({ time: Number(r.t), open: Number(r.o), high: Number(r.h), low: Number(r.l), close: Number(r.c) }))))
  }, [view, top])

  const Mkt = (t) => (
    <a className="ld-mkt" key={t.token} onClick={() => nav('/coin/' + t.token)}>
      <div className="ld-mkt-img"><span>{(t.symbol || '?')[0].toUpperCase()}</span>{t.imageUrl && <img src={t.imageUrl} onError={(e) => e.target.remove()} />}</div>
      <div className="ld-mkt-main"><b>{t.symbol}</b><span>{usd(t.fdvUsd / (eth || 1), eth)} MC</span></div>
      <div className="ld-mkt-right"><b>{usd(t.volume24hUsd / (eth || 1), eth)}</b><span className={t.change24h > 0 ? 'up' : t.change24h < 0 ? 'down' : ''}>{t.change24h > 0 ? '+' : ''}{(t.change24h || 0).toFixed(0)}%</span></div>
    </a>
  )

  return (
    <div className="ld">
      <video className="ld-sky" src="/sky.mp4" autoPlay muted loop playsInline />
      <div className="ld-topbar">
        <a className="ld-xbtn" href="https://x.com/bullishdotrun/" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.46l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93Zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41Z" /></svg>
          Follow us on X
        </a>
        <button className="ld-loginbtn" onClick={() => auth.login()}>Log in</button>
      </div>
      <div className="ld-wrap">
        <div className="ld-brand"><img src="/logo.png" alt="" /><span>bullish</span></div>
        <div className="ld-badges"><span className="ld-badge">⚡ Built on Robinhood Chain</span><span className="ld-badge alt">◎ Trade with SOL</span></div>
        <h1 className="ld-h1">Trade and launch Robinhood<br />tokens on Solana</h1>
        <p className="ld-sub">Every new Robinhood Chain coin, streamed live — buy, sell and launch<br />with one Phantom signature.</p>
        <a className="ld-cta" onClick={() => nav('/home')}>Start Trading</a>
        <div className="ld-tabs">{['markets', 'pulse', 'launch'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>

        <div className="ld-frame">
          <div className="ld-frame-top"><span className="ld-frame-brand"><img src="/logo.png" alt="" />bullish</span><span className="ld-frame-right"><span>PORTFOLIO</span><b>$12,480</b></span></div>
          {view === 'markets' && (
            <div className="ld-frame-body"><div className="ld-mkts">{top.map(Mkt)}</div><div className="ld-chart-wrap"><div className="ld-chart-head">{top[0] ? <><b>{top[0].symbol}</b> /WETH · {usd(top[0].fdvUsd / (eth || 1), eth)} MC</> : 'Loading…'}</div><div className="ld-chart" ref={chartRef} /></div></div>
          )}
          {view === 'pulse' && (
            <div className="ld-frame-body">
              <div className="ld-pcol"><div className="ld-pcol-head">New Pairs</div>{pulse.newPairs.slice(0, 5).map(Mkt)}</div>
              <div className="ld-pcol"><div className="ld-pcol-head">Final Stretch</div>{pulse.finalStretch.slice(0, 5).map(Mkt)}</div>
              <div className="ld-pcol"><div className="ld-pcol-head">Migrated</div>{pulse.migrated.slice(0, 5).map(Mkt)}</div>
            </div>
          )}
          {view === 'launch' && (
            <div className="ld-frame-body"><div className="ld-lf"><div className="ld-lf-head"><b>Launch a coin</b><span className="ld-lf-pill">LIVE</span></div><div className="ld-lf-sub">Deploy on Robinhood Chain — pay from your Solana wallet</div><div className="ld-lf-config"><div><span>Total Supply</span><b>1B</b></div><div><span>Liquidity</span><b>Locked forever</b></div><div><span>Creator Fees</span><b>Paid as SOL</b></div></div><a className="ld-lf-cta" onClick={() => nav('/launch')}>Launch a coin</a></div></div>
          )}
        </div>
        <div className="ld-foot">© 2026 bullish.run · Robinhood Chain · Powered by Relay</div>
      </div>
    </div>
  )
}
