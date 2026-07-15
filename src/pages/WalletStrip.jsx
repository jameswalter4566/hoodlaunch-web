import { forwardRef, useEffect, useImperativeHandle, useState, useCallback } from 'react'
import * as B from '../lib/bundler.js'

// Pre-launch bundle-wallet setup, shown on the /admin launch panel. Manages the
// SAME shared wallet pool the bundler terminal uses (B.loadSlots), lets the admin
// create/import + fund Solana buyers and set each one's snipe amount, then fires
// every funded wallet's Relay buy the instant the launch confirms.
const WalletStrip = forwardRef(function WalletStrip(_props, ref) {
  const [slots, setSlots] = useState(B.loadSlots)
  const [bal, setBal] = useState({}) // id -> SOL
  const [snipe, setSnipe] = useState({}) // id -> 'buying'|'ok'|'fail'
  const [menu, setMenu] = useState(false)
  const [importing, setImporting] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState('')

  const persist = (next) => { setSlots(next); B.saveSlots(next) }

  const refresh = useCallback(async () => {
    const cur = B.loadSlots()
    const out = {}
    await Promise.all(cur.map(async (s) => { out[s.id] = await B.solBalance(s.solPubkey) }))
    setBal(out)
  }, [])
  useEffect(() => { refresh(); const i = setInterval(refresh, 12000); return () => clearInterval(i) }, [refresh])

  const addNew = () => { persist([...slots, B.newSlot()]); setMenu(false) }
  const doImport = () => { try { const s = B.importSlot(draft); if (!slots.some((x) => x.id === s.id)) persist([...slots, s]); setDraft(''); setImporting(false) } catch { alert('Invalid Solana private key') } }
  const remove = (id) => persist(slots.filter((s) => s.id !== id))
  const setAmt = (id, snipeSol) => persist(slots.map((s) => (s.id === id ? { ...s, snipeSol } : s)))
  const copyFund = (s) => { navigator.clipboard.writeText(s.solPubkey).catch(() => {}); setCopied(s.id); setTimeout(() => setCopied(''), 1100) }

  useImperativeHandle(ref, () => ({
    hasSnipers: () => B.loadSlots().some((s) => Number(s.snipeSol) > 0),
    async fire(tokenAddress) {
      const targets = B.loadSlots().filter((s) => Number(s.snipeSol) > 0)
      setSnipe(Object.fromEntries(targets.map((s) => [s.id, 'buying'])))
      // fire ALL buys at once — no stagger, every wallet hits the block ASAP
      await Promise.all(targets.map((s) =>
        B.buy(s, tokenAddress, Number(s.snipeSol))
          .then(() => setSnipe((x) => ({ ...x, [s.id]: 'ok' })))
          .catch(() => setSnipe((x) => ({ ...x, [s.id]: 'fail' }))),
      ))
      refresh()
    },
  }), [refresh])

  const cls = (s) => (snipe[s.id] === 'ok' ? ' ok' : snipe[s.id] === 'fail' ? ' fail' : snipe[s.id] === 'buying' ? ' buying' : '')

  return (
    <div className="aw">
      <div className="aw-head">
        <span className="aw-lbl">Bundle wallets</span>
        <span className="aw-note">buy on launch via Relay · full control on the bundler page after launch</span>
        {slots.length > 0 && <button className="aw-refresh" onClick={refresh} title="Refresh balances">↻</button>}
      </div>

      <div className="aw-rows">
        {slots.map((s, i) => (
          <div className={'aw-row' + cls(s)} key={s.id}>
            <button className={'aw-copy' + (copied === s.id ? ' ok' : '')} title="Copy Solana address to fund with SOL" onClick={() => copyFund(s)}>{copied === s.id ? '✓' : '⧉'}</button>
            <span className="aw-idx">{i + 1}</span>
            <span className="aw-pair">
              <span className="aw-sol" title={'Solana buyer ' + s.solPubkey}>SOL {B.short(s.solPubkey)}</span>
              <span className="aw-arrow">→</span>
              <span className="aw-evm" title={'EVM holder/seller ' + s.evmAddress}>ETH {B.short(s.evmAddress)}</span>
            </span>
            <span className="aw-bal"><b>{bal[s.id] == null ? '—' : bal[s.id].toFixed(3)}</b> SOL</span>
            <div className="aw-amt"><input type="number" min="0" step="0.01" value={s.snipeSol} onChange={(e) => setAmt(s.id, e.target.value)} placeholder="0.0" /><span>SOL snipe</span></div>
            <button className="aw-rm" title="Remove" onClick={() => remove(s.id)}>✕</button>
          </div>
        ))}

        {importing ? (
          <div className="aw-import">
            <input autoFocus className="aw-in" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doImport()} placeholder="Paste Solana private key (base58 or [1,2,…])" />
            <button className="aw-go" onClick={doImport}>Import</button>
            <button className="aw-cancel" onClick={() => { setImporting(false); setDraft('') }}>✕</button>
          </div>
        ) : menu ? (
          <div className="aw-menu">
            <button className="aw-mi" onClick={addNew}>+ Add new</button>
            <button className="aw-mi" onClick={() => { setImporting(true); setMenu(false) }}>↓ Import</button>
            <button className="aw-cancel" onClick={() => setMenu(false)}>✕</button>
          </div>
        ) : (
          <button className="aw-add" onClick={() => setMenu(true)}>+ Add wallet</button>
        )}
      </div>
    </div>
  )
})

export default WalletStrip
