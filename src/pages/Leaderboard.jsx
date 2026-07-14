import { useEffect, useState } from 'react'
import { getJSON, usd, ethUsd, shortAddr } from '../api'

const TABS = [
  { key: 'volume', label: 'Top Volume' },
  { key: 'deployments', label: 'Most Deployments' },
  { key: 'fees', label: 'Most Fees Earned' },
]

export default function Leaderboard() {
  const [tab, setTab] = useState('volume')
  const [rows, setRows] = useState([])
  const [eth, setEth] = useState(0)

  useEffect(() => {
    let alive = true
    ethUsd().then((v) => alive && setEth(v))
    getJSON('/api/leaderboard?by=' + tab).then((d) => alive && setRows(d.rows || [])).catch(() => alive && setRows([]))
    return () => { alive = false }
  }, [tab])

  return (
    <div className="main">
      <div className="lb-wrap">
        <div className="section-head"><h2>Leaderboard</h2>
          <div className="tabs">{TABS.map((t) => <button key={t.key} className={'tab' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
        </div>
        <div className="lb-list">
          {rows.length === 0 && <div className="lb-empty">No data yet — start trading and launching.</div>}
          {rows.map((r, i) => (
            <div className="lb-row" key={r.solana_address}>
              <div className="lb-rank">{i + 1}</div>
              <div className="lb-av">{r.avatar_url ? <img src={r.avatar_url} alt="" /> : (r.username || r.solana_address || '?').slice(0, 2).toUpperCase()}</div>
              <div className="lb-name"><b>{r.username || shortAddr(r.solana_address)}</b><span>{shortAddr(r.solana_address)}</span></div>
              <div className="lb-stat">
                {tab === 'deployments' ? r.value + ' launches' : usd(Number(r.value), eth)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
