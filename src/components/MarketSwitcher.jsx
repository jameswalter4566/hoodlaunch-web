// Robinhood / Solana market switcher — segmented pill toggle in the grey/white
// scheme (same shape as the landing tabs). Persists the choice in localStorage.
import { useState } from 'react'

export default function MarketSwitcher({ onChange }) {
  const [mkt, setMkt] = useState(localStorage.getItem('pl-market') || 'robinhood')
  const pick = (m) => { setMkt(m); localStorage.setItem('pl-market', m); onChange?.(m) }
  return (
    <div className="mkt-seg">
      <button className={mkt === 'robinhood' ? 'on' : ''} onClick={() => pick('robinhood')}>Robinhood</button>
      <button className={mkt === 'solana' ? 'on' : ''} onClick={() => pick('solana')}>Solana</button>
    </div>
  )
}
