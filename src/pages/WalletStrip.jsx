import { useEffect, useRef, useState } from 'react'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

// Admin-only reference wallets: import Solana wallets by private key (or generate
// fresh ones), keep them in a horizontal strip, and quick-export the key back out.
// Stored in localStorage on this browser only — private keys never leave the client.
const KEY = 'hl_admin_wallets'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }
const save = (w) => localStorage.setItem(KEY, JSON.stringify(w))
const short = (a) => a.slice(0, 4) + '…' + a.slice(-4)

// Accept a base58 secret key (Phantom export) or a JSON byte array (Solana CLI).
function parseSecret(input) {
  const s = input.trim()
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s)
  const kp = Keypair.fromSecretKey(bytes) // throws if not a valid 64-byte secret
  return { pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) }
}

export default function WalletStrip() {
  const [wallets, setWallets] = useState(load)
  const [menu, setMenu] = useState(false) // '+' menu open
  const [importing, setImporting] = useState(false)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('') // pubkey of the wallet flashing "copied"
  const importRef = useRef(null)

  useEffect(() => save(wallets), [wallets])
  useEffect(() => { if (importing) importRef.current?.focus() }, [importing])

  const add = (w) => {
    if (wallets.some((x) => x.pubkey === w.pubkey)) { setErr('Wallet already added'); return }
    setWallets((prev) => [...prev, w]); reset()
  }
  const reset = () => { setMenu(false); setImporting(false); setDraft(''); setErr('') }

  const addNew = () => add({ ...(({ publicKey, secretKey }) => ({ pubkey: publicKey.toBase58(), secret: bs58.encode(secretKey) }))(Keypair.generate()) })
  const doImport = () => { try { add(parseSecret(draft)) } catch { setErr('Invalid private key') } }
  const remove = (pubkey) => setWallets((prev) => prev.filter((x) => x.pubkey !== pubkey))

  const exportKey = async (w) => {
    try { await navigator.clipboard.writeText(w.secret) } catch { /* clipboard blocked */ }
    setCopied(w.pubkey); setTimeout(() => setCopied(''), 1300)
  }
  const copyPub = async (w) => { try { await navigator.clipboard.writeText(w.pubkey) } catch { /* */ } }

  return (
    <div className="aw">
      <div className="aw-head"><span className="aw-lbl">Reference wallets</span><span className="aw-note">Solana · stored on this device only</span></div>
      <div className="aw-strip">
        {wallets.map((w, i) => (
          <div className="aw-chip" key={w.pubkey}>
            <span className="aw-idx">{i + 1}</span>
            <button className="aw-addr" title="Copy public key" onClick={() => copyPub(w)}>{short(w.pubkey)}</button>
            <button className={'aw-exp' + (copied === w.pubkey ? ' ok' : '')} title="Copy private key" onClick={() => exportKey(w)}>
              {copied === w.pubkey ? 'Copied ✓' : 'Export'}
            </button>
            <button className="aw-rm" title="Remove" onClick={() => remove(w.pubkey)}>✕</button>
          </div>
        ))}

        {importing ? (
          <div className="aw-import">
            <input ref={importRef} className="aw-in" value={draft} onChange={(e) => { setDraft(e.target.value); setErr('') }}
              onKeyDown={(e) => e.key === 'Enter' && doImport()} placeholder="Paste private key (base58 or [1,2,…])" />
            <button className="aw-go" onClick={doImport}>Import</button>
            <button className="aw-cancel" onClick={reset}>✕</button>
          </div>
        ) : menu ? (
          <div className="aw-menu">
            <button className="aw-mi" onClick={addNew}>+ Add new</button>
            <button className="aw-mi" onClick={() => { setImporting(true); setMenu(false) }}>↓ Import</button>
            <button className="aw-cancel" onClick={reset}>✕</button>
          </div>
        ) : (
          <button className="aw-plus" title="Add a wallet" onClick={() => { setMenu(true); setErr('') }}>+</button>
        )}
      </div>
      {err && <div className="aw-err">{err}</div>}
    </div>
  )
}
