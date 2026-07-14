import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API, usd, fmtAge, ethUsd, shortAddr } from '../api'
import MarketSwitcher from '../components/MarketSwitcher.jsx'

const TABS = [
  { key: 'all', label: '🔥 All' },
  { key: 'new', label: '🌱 New' },
  { key: 'graduating', label: '📈 Graduating' },
  { key: 'graduated', label: '🎓 Graduated' },
]

// deterministic sparkline from the address (until per-token candles are wired here)
function spark(t) {
  const up = (t.priceChange24h ?? 0) >= 0
  let seed = 0
  for (let i = 2; i < 10; i++) seed = (seed * 31 + t.address.charCodeAt(i)) % 997
  const pts = []
  let y = 26
  for (let x = 0; x <= 100; x += 10) { seed = (seed * 73 + 11) % 997; y = Math.min(30, Math.max(4, y + ((seed % 11) - (up ? 6 : 4)))); pts.push(x + ',' + y) }
  return <svg viewBox="0 0 100 32" preserveAspectRatio="none"><polyline points={pts.join(' ')} fill="none" stroke={up ? '#21c95e' : '#f6465d'} strokeWidth="1.6" opacity="0.9" /></svg>
}

function Card({ t, eth }) {
  return (
    <Link className="pcard" to={'/coin/' + t.address}>
      <div className="pcard-img">
        {t.image_url ? <img src={t.image_url} onError={(e) => e.target.remove()} /> : <span className="letter">{(t.symbol || '?')[0].toUpperCase()}</span>}
        <div className="pcard-spark">{spark(t)}</div>
      </div>
      <div className="pcard-name">{t.name}</div>
      <div className="pcard-tick">${t.symbol}</div>
      <div className="pcard-mc"><b>{usd(t.marketCapEth, eth)}</b><span>MC</span></div>
      <div className="pcard-meta"><span>🌱 {shortAddr(t.creator)}</span><span className="age">{fmtAge(t.created_at)}</span></div>
    </Link>
  )
}

export default function Home() {
  const [board, setBoard] = useState({ new: [], graduating: [], graduated: [] })
  const [eth, setEth] = useState(0)
  const [tab, setTab] = useState('all')
  const [kw, setKw] = useState('')
  const [market, setMarket] = useState(localStorage.getItem('pl-market') || 'robinhood')

  useEffect(() => {
    let alive = true
    const load = () => fetch(API + '/api/board').then((r) => r.json()).then((d) => alive && setBoard(d))
    load(); ethUsd().then((v) => alive && setEth(v))
    const i = setInterval(load, 5000)
    return () => { alive = false; clearInterval(i) }
  }, [])

  const list = (market === 'solana' ? [] : (tab === 'all' ? [].concat(board.graduated, board.graduating, board.new) : board[tab]) || [])
    .filter((t) => !kw || (t.symbol + ' ' + t.name + ' ' + t.address).toLowerCase().includes(kw.toLowerCase()))

  return (
    <div className="main">
      <div className="searchbar"><input placeholder="Search for coins..." value={kw} onChange={(e) => setKw(e.target.value)} /></div>
      <div className="section-head">
        <h2>Explore coins</h2>
        <MarketSwitcher onChange={setMarket} />
        <div className="tabs">{TABS.map((t) => <button key={t.key} className={'tab' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
      </div>
      <div className="grid">
        {market === 'solana'
          ? <div className="grid-empty">Solana markets — coming soon.</div>
          : list.length
            ? list.map((t) => <Card key={t.address} t={t} eth={eth} />)
            : <div className="grid-empty">No coins here yet — be the first to <Link to="/launch" style={{ color: 'var(--green)' }}>launch one</Link>.</div>}
      </div>
    </div>
  )
}
