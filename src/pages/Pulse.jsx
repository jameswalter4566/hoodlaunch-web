import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, usd, fmtAge, ethUsd } from '../api'

const BUCKETS = [
  { key: 'newPairs', label: 'New Pairs' },
  { key: 'finalStretch', label: 'Final Stretch' },
  { key: 'migrated', label: 'Migrated' },
]

function socialLinks(t) {
  const s = t.socials || {}
  const fix = (u, base) => (String(u).startsWith('http') ? String(u) : base + String(u).replace(/^@/, ''))
  const out = []
  if (s.twitter) out.push(['𝕏', fix(s.twitter, 'https://x.com/')])
  if (s.telegram) out.push(['✈', fix(s.telegram, 'https://t.me/')])
  if (s.website) out.push(['🌐', fix(s.website, 'https://')])
  return out
}

function Row({ t, eth }) {
  const total = t.buys24h + t.sells24h
  const buyPct = total ? Math.round((t.buys24h / total) * 100) : 50
  const padCls = t.launchpad === 'bullish.run' ? 'ours' : t.launchpad === 'Noxa.Fun' ? 'noxa' : ''
  const chip = (label, v) => (
    <span className={'pl-chg ' + (v > 0 ? 'up' : v < 0 ? 'down' : '')}>{label} {v > 0 ? '+' : ''}{v.toFixed(0)}%</span>
  )
  return (
    <Link className="pl-row" to={'/coin/' + t.token}>
      <div className="pl-img">
        <span>{(t.symbol || '?')[0].toUpperCase()}</span>
        {t.imageUrl && <img src={t.imageUrl} loading="lazy" onError={(e) => e.target.remove()} />}
      </div>
      <div className="pl-main">
        <div className="pl-l1">
          <b>{t.symbol}</b><span className="pl-pairlbl">/{t.pair}</span>
          {t.feeTier && <span className="pl-fee">{t.feeTier}%</span>}
          {socialLinks(t).map(([icon, url], i) => (
            <span key={i} className="pl-soc" onClick={(e) => { e.preventDefault(); window.open(url, '_blank') }}>{icon}</span>
          ))}
        </div>
        <div className="pl-l2">
          <span className="pl-age">{fmtAge(t.createdAt)}</span>
          <span className={'pl-pad ' + padCls}>{t.launchpad}</span>
          <span className="pl-mini">TX {total}</span>
          <span className="pl-mini pl-bs"><i style={{ width: buyPct + '%' }} /></span>
        </div>
        <div className="pl-l3">{chip('5m', t.change5m)}{chip('1h', t.change1h)}{chip('24h', t.change24h)}<span className="pl-mini">💧 {usd(t.liquidityUsd / (eth || 1), eth)}</span></div>
      </div>
      <div className="pl-right">
        <div className="pl-metr"><span>V</span><b>{usd(t.volume24hUsd / (eth || 1), eth)}</b></div>
        <div className="pl-metr"><span>MC</span><b className="mc">{usd(t.fdvUsd / (eth || 1), eth)}</b></div>
        <span className="pl-buy">⚡ Buy</span>
      </div>
    </Link>
  )
}

export default function Pulse() {
  const [data, setData] = useState({ newPairs: [], finalStretch: [], migrated: [] })
  const [eth, setEth] = useState(0)
  const wsRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetch(API + '/api/pulse').then((r) => r.json()).then((d) => alive && setData(d))
    ethUsd().then((v) => alive && setEth(v))
    function connect() {
      const ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws')
      wsRef.current = ws
      ws.onmessage = (e) => alive && setData(JSON.parse(e.data))
      ws.onclose = () => alive && setTimeout(connect, 3000)
    }
    connect()
    const tick = setInterval(() => ethUsd().then((v) => alive && setEth(v)), 60000)
    return () => { alive = false; clearInterval(tick); wsRef.current?.close() }
  }, [])

  return (
    <div className="main pl-wrap">
      <div className="pl-topbar"><span className="pl-title">Pulse</span><span className="pl-sub">chain-wide · live</span></div>
      <div className="pl-board">
        {BUCKETS.map((b) => (
          <section className="pl-col" key={b.key}>
            <header className="pl-col-head"><span>{b.label}</span><i>{data[b.key]?.length || 0}</i></header>
            <div className="pl-col-body">
              {data[b.key]?.length ? data[b.key].map((t) => <Row key={t.token} t={t} eth={eth} />) : <div className="pl-empty">🪧<br />No Data</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
