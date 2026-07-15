import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import { Connection, Transaction, PublicKey, TransactionInstruction, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import bs58 from 'bs58'
import { API, RELAY } from '../api'

// Admin-only reference / bundle wallets. Import or generate Solana wallets, fund
// them, set a SOL buy amount each, and they all snipe the token via Relay the
// instant the launch confirms. Keys live in localStorage on this browser only.
const KEY = 'hl_admin_wallets'
const SOLANA_RPC = API + '/api/solana-rpc'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] } }
const saveLs = (w) => localStorage.setItem(KEY, JSON.stringify(w))
const short = (a) => a.slice(0, 4) + '…' + a.slice(-4)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hexToBytes = (hex) => { const h = hex.replace(/^0x/, ''); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o }

// Accept a base58 secret key (Phantom export) or a JSON byte array (Solana CLI).
function parseSecret(input) {
  const s = input.trim()
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s)
  const kp = Keypair.fromSecretKey(bytes)
  return { pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) }
}

const WalletStrip = forwardRef(function WalletStrip(_props, ref) {
  const [wallets, setWallets] = useState(load) // { label?, pubkey, secret, amount }
  const [balances, setBalances] = useState({}) // pubkey -> SOL number
  const [snipe, setSnipe] = useState({}) // pubkey -> 'buying' | 'ok' | 'fail'
  const [menu, setMenu] = useState(false)
  const [importing, setImporting] = useState(false)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const importRef = useRef(null)

  useEffect(() => saveLs(wallets), [wallets])
  useEffect(() => { if (importing) importRef.current?.focus() }, [importing])

  const refreshBalances = useCallback(async () => {
    if (!wallets.length) return
    const conn = new Connection(SOLANA_RPC)
    const out = {}
    await Promise.all(wallets.map(async (w) => {
      try { out[w.pubkey] = (await conn.getBalance(new PublicKey(w.pubkey))) / LAMPORTS_PER_SOL } catch { out[w.pubkey] = null }
    }))
    setBalances(out)
  }, [wallets])

  useEffect(() => { refreshBalances() }, [refreshBalances])

  const reset = () => { setMenu(false); setImporting(false); setDraft(''); setErr('') }
  const add = (w) => {
    if (wallets.some((x) => x.pubkey === w.pubkey)) { setErr('Wallet already added'); return }
    setWallets((prev) => [...prev, { ...w, amount: '' }]); reset()
  }
  const addNew = () => { const kp = Keypair.generate(); add({ pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) }) }
  const doImport = () => { try { add(parseSecret(draft)) } catch { setErr('Invalid private key') } }
  const remove = (pubkey) => setWallets((prev) => prev.filter((x) => x.pubkey !== pubkey))
  const setAmount = (pubkey, amount) => setWallets((prev) => prev.map((w) => (w.pubkey === pubkey ? { ...w, amount } : w)))

  const copyPub = async (w) => { try { await navigator.clipboard.writeText(w.pubkey); setCopied('a:' + w.pubkey); setTimeout(() => setCopied(''), 1100) } catch { /* */ } }
  const exportKey = async (w) => { try { await navigator.clipboard.writeText(w.secret) } catch { /* */ } setCopied('e:' + w.pubkey); setTimeout(() => setCopied(''), 1300) }

  // Buy the freshly-launched token from ONE reference wallet, paid in SOL via Relay,
  // signed by that wallet's local keypair. Tokens land at evmRecipient on Robinhood Chain.
  async function buyOne(w, tokenAddress, evmRecipient) {
    const lamports = Math.floor(Number(w.amount) * LAMPORTS_PER_SOL)
    if (!lamports) return
    const q = await fetch(API + '/api/quote/buy?token=' + tokenAddress + '&lamports=' + lamports + '&solanaAddress=' + w.pubkey + '&evmRecipient=' + evmRecipient).then((r) => r.json())
    if (!q.steps) throw new Error(q.message || 'quote failed')
    const conn = new Connection(SOLANA_RPC)
    const tx = new Transaction()
    q.steps.forEach((s) => s.items.forEach((it) => (it.data.instructions || []).forEach((ins) => tx.add(new TransactionInstruction({ programId: new PublicKey(ins.programId), keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: hexToBytes(ins.data) })))))
    tx.feePayer = new PublicKey(w.pubkey)
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
    tx.sign(Keypair.fromSecretKey(bs58.decode(w.secret)))
    await conn.sendRawTransaction(tx.serialize())
    const check = q.steps[0].items[0].check
    for (let i = 0; i < 45; i++) {
      await sleep(2000)
      const st = await fetch(RELAY + check.endpoint).then((r) => r.json())
      if (st.status === 'success') return
      if (st.status === 'failure' || st.status === 'refund') throw new Error('relay ' + st.status)
    }
  }

  // Exposed to AdminLaunch — fire every funded wallet's buy in parallel the moment
  // the token address is known.
  useImperativeHandle(ref, () => ({
    hasSnipers: () => wallets.some((w) => Number(w.amount) > 0),
    async fire(tokenAddress, evmRecipient) {
      const targets = wallets.filter((w) => Number(w.amount) > 0)
      setSnipe(Object.fromEntries(targets.map((w) => [w.pubkey, 'buying'])))
      await Promise.all(targets.map((w) =>
        buyOne(w, tokenAddress, evmRecipient)
          .then(() => setSnipe((s) => ({ ...s, [w.pubkey]: 'ok' })))
          .catch(() => setSnipe((s) => ({ ...s, [w.pubkey]: 'fail' }))),
      ))
      refreshBalances()
    },
  }), [wallets, refreshBalances])

  const bal = (w) => { const b = balances[w.pubkey]; return b == null ? '—' : b.toFixed(3) }
  const snipeCls = (w) => (snipe[w.pubkey] === 'ok' ? ' ok' : snipe[w.pubkey] === 'fail' ? ' fail' : snipe[w.pubkey] === 'buying' ? ' buying' : '')

  return (
    <div className="aw">
      <div className="aw-head">
        <span className="aw-lbl">Bundle wallets</span>
        <span className="aw-note">Solana · buy on launch via Relay · keys on this device only</span>
        {wallets.length > 0 && <button className="aw-refresh" onClick={refreshBalances} title="Refresh balances">↻</button>}
      </div>

      <div className="aw-rows">
        {wallets.map((w, i) => (
          <div className={'aw-row' + snipeCls(w)} key={w.pubkey}>
            <button className={'aw-copy' + (copied === 'a:' + w.pubkey ? ' ok' : '')} title="Copy address to fund this wallet" onClick={() => copyPub(w)}>
              {copied === 'a:' + w.pubkey ? '✓' : '⧉'}
            </button>
            <span className="aw-idx">{i + 1}</span>
            <span className="aw-addr" title={w.pubkey}>{short(w.pubkey)}</span>
            <span className="aw-bal"><b>{bal(w)}</b> SOL</span>
            <div className="aw-amt">
              <input type="number" min="0" step="0.01" value={w.amount} onChange={(e) => setAmount(w.pubkey, e.target.value)} placeholder="0.0" />
              <span>SOL buy</span>
            </div>
            <button className={'aw-exp' + (copied === 'e:' + w.pubkey ? ' ok' : '')} title="Copy private key" onClick={() => exportKey(w)}>
              {copied === 'e:' + w.pubkey ? 'Copied ✓' : 'Export'}
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
          <button className="aw-add" title="Add a wallet" onClick={() => { setMenu(true); setErr('') }}>+ Add wallet</button>
        )}
      </div>
      {err && <div className="aw-err">{err}</div>}
    </div>
  )
})

export default WalletStrip
