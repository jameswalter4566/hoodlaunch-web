// Admin bundler engine — all wallet + trade logic in one place so every button in
// the terminal calls tested functions. Buys go through Relay (SOL from a Solana
// wallet -> tokens delivered to that slot's EVM twin) so they match a real user's
// footprint; sells are native Robinhood-Chain swaps signed by the EVM twin's key.
import { Connection, Transaction, PublicKey, TransactionInstruction, Keypair, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { createPublicClient, createWalletClient, http, defineChain, encodeFunctionData, publicActions } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import bs58 from 'bs58'
import { API, RELAY } from '../api'

// ---- Robinhood Chain (EVM, id 4663) — same config as Token.jsx ----
export const RH = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } })
export const rhClient = createPublicClient({ chain: RH, transport: http() })
const SWAP_ROUTER = '0xCaf681a66D020601342297493863E78C959E5cb2'
const WETH_ADDR = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'
const POOL_FEE = 10000
const MAX_UINT = (1n << 256n) - 1n
const erc20Abi = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
]
const routerAbi = [{ type: 'function', name: 'exactInputSingle', stateMutability: 'payable', inputs: [{ type: 'tuple', components: [
  { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
  { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }, { name: 'sqrtPriceLimitX96', type: 'uint160' } ] }], outputs: [{ type: 'uint256' }] }]
const wethAbi = [
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const SOLANA_RPC = API + '/api/solana-rpc'
const hexToBytes = (hex) => { const h = hex.replace(/^0x/, ''); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// leave this much SOL in a buyer wallet for network fee + any Relay account rent
const SOL_FEE_BUFFER = 0.004

// ---- slot storage: one shared pool of wallets, reused across launches ----
const POOL_KEY = 'hl_bundle_pool'
export const loadSlots = () => { try { return JSON.parse(localStorage.getItem(POOL_KEY)) || [] } catch { return [] } }
export const saveSlots = (slots) => localStorage.setItem(POOL_KEY, JSON.stringify(slots))

// each slot = a Solana buyer + a paired EVM holder/seller
export function newSlot() {
  const sol = Keypair.generate()
  const evmPk = generatePrivateKey()
  const evm = privateKeyToAccount(evmPk)
  return { id: sol.publicKey.toBase58(), solPubkey: sol.publicKey.toBase58(), solSecret: bs58.encode(sol.secretKey), evmAddress: evm.address, evmPk, snipeSol: '' }
}

// import a Solana buyer key (base58 or JSON byte array); always mint a fresh EVM twin
export function importSlot(input) {
  const s = input.trim()
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s)
  const kp = Keypair.fromSecretKey(bytes) // throws if invalid
  const evmPk = generatePrivateKey()
  const evm = privateKeyToAccount(evmPk)
  return { id: kp.publicKey.toBase58(), solPubkey: kp.publicKey.toBase58(), solSecret: bs58.encode(kp.secretKey), evmAddress: evm.address, evmPk, snipeSol: '' }
}

// ---- balances ----
export async function solBalance(pubkey) {
  try { return (await new Connection(SOLANA_RPC).getBalance(new PublicKey(pubkey))) / LAMPORTS_PER_SOL } catch { return null }
}
export async function tokenState(tokenAddress, evmAddress) {
  try {
    const [bal, supply] = await Promise.all([
      rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [evmAddress] }),
      rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'totalSupply' }),
    ])
    return { tokens: Number(bal) / 1e18, supplyPct: supply > 0n ? Number((bal * 1000000n) / supply) / 10000 : 0, raw: bal }
  } catch { return { tokens: null, supplyPct: null, raw: 0n } }
}
export async function evmEthBalance(evmAddress) {
  try { return Number(await rhClient.getBalance({ address: evmAddress })) / 1e18 } catch { return null }
}

// Batched balance read for the terminal: ONE totalSupply call, then SOL + token +
// ETH per slot. Keeps RPC load to ~2 RH calls per wallet instead of 3.
export async function walletStates(tokenAddress, slots) {
  let supply = 0n
  try { supply = await rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'totalSupply' }) } catch { /* keep 0 */ }
  const out = {}
  await Promise.all(slots.map(async (s) => {
    const [sol, tok, ethBal] = await Promise.all([
      solBalance(s.solPubkey),
      rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [s.evmAddress] }).catch(() => 0n),
      rhClient.getBalance({ address: s.evmAddress }).catch(() => 0n),
    ])
    out[s.id] = { sol, tokens: Number(tok) / 1e18, supplyPct: supply > 0n ? Number((tok * 1000000n) / supply) / 10000 : 0, ethBal: Number(ethBal) / 1e18 }
  }))
  return out
}

// ---- BUY: Relay SOL -> token, paid + signed by the slot's Solana wallet ----
// solAmount is the SOL to spend; tokens are delivered to the slot's EVM twin.
export async function buy(slot, tokenAddress, solAmount) {
  const lamports = Math.floor(Number(solAmount) * LAMPORTS_PER_SOL)
  if (!(lamports > 0)) throw new Error('Buy amount must be > 0')
  const q = await fetch(`${API}/api/quote/buy?token=${tokenAddress}&lamports=${lamports}&solanaAddress=${slot.solPubkey}&evmRecipient=${slot.evmAddress}`).then((r) => r.json())
  if (!q.steps) throw new Error(q.message || q.error || 'Quote failed')
  const conn = new Connection(SOLANA_RPC)
  const tx = new Transaction()
  q.steps.forEach((s) => s.items.forEach((it) => (it.data.instructions || []).forEach((ins) => tx.add(new TransactionInstruction({
    programId: new PublicKey(ins.programId),
    keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: hexToBytes(ins.data),
  })))))
  tx.feePayer = new PublicKey(slot.solPubkey)
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  tx.sign(Keypair.fromSecretKey(bs58.decode(slot.solSecret)))
  const sig = await conn.sendRawTransaction(tx.serialize())
  const check = q.steps[0].items[0].check
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const st = await fetch(RELAY + check.endpoint).then((r) => r.json()).catch(() => ({}))
    if (st.status === 'success') return { sig, filled: true }
    if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status)
  }
  return { sig, filled: false } // submitted but still filling; balances will catch up
}

// spend a % of the slot's current SOL balance (100% keeps a fee buffer)
export async function buyPct(slot, tokenAddress, pct) {
  const bal = await solBalance(slot.solPubkey)
  if (bal == null) throw new Error('Could not read SOL balance')
  const spend = pct >= 100 ? Math.max(0, bal - SOL_FEE_BUFFER) : bal * (pct / 100)
  if (!(spend > 0)) throw new Error('Not enough SOL (fund this wallet first)')
  return buy(slot, tokenAddress, spend)
}

// ---- SELL: native token -> WETH -> ETH, signed by the slot's EVM twin ----
export async function sellPct(slot, tokenAddress, pct) {
  const account = privateKeyToAccount(slot.evmPk)
  const wallet = createWalletClient({ account, chain: RH, transport: http() }).extend(publicActions)
  const bal = await rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [slot.evmAddress] })
  if (bal === 0n) throw new Error('No tokens to sell')
  const p = Math.min(100, Math.max(1, Number(pct) || 100))
  const amountWei = (bal * BigInt(Math.floor(p * 100))) / 10000n
  // the twin holds tokens but needs a little ETH for gas — treasury dusts it (blocks til confirmed)
  await fetch(`${API}/api/gas/topup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evmAddress: slot.evmAddress }) })
  // approve router once (MAX so future sells skip it)
  const allowance = await rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'allowance', args: [slot.evmAddress, SWAP_ROUTER] })
  if (allowance < amountWei) {
    const h = await wallet.sendTransaction({ to: tokenAddress, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SWAP_ROUTER, MAX_UINT] }) })
    await rhClient.waitForTransactionReceipt({ hash: h })
  }
  // swap token -> WETH
  const h2 = await wallet.sendTransaction({ to: SWAP_ROUTER, data: encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: tokenAddress, tokenOut: WETH_ADDR, fee: POOL_FEE, recipient: slot.evmAddress, amountIn: amountWei, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }) })
  await rhClient.waitForTransactionReceipt({ hash: h2 })
  // unwrap WETH -> native ETH
  const wbal = await rhClient.readContract({ address: WETH_ADDR, abi: wethAbi, functionName: 'balanceOf', args: [slot.evmAddress] })
  if (wbal > 0n) { const h3 = await wallet.sendTransaction({ to: WETH_ADDR, data: encodeFunctionData({ abi: wethAbi, functionName: 'withdraw', args: [wbal] }) }); await rhClient.waitForTransactionReceipt({ hash: h3 }) }
  return { sold: amountWei.toString() }
}

// ---- DEV wallet (launch creator, Privy embedded) sell — signed by Phantom-linked Privy ----
export async function sellDev(auth, tokenAddress, pct) {
  const evm = auth.evmAddress
  if (!evm) throw new Error('Dev wallet not ready')
  const bal = await rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [evm] })
  if (bal === 0n) throw new Error('Dev wallet has no tokens')
  const p = Math.min(100, Math.max(1, Number(pct) || 100))
  const amountWei = (bal * BigInt(Math.floor(p * 100))) / 10000n
  await fetch(`${API}/api/gas/topup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evmAddress: evm }) })
  try { await auth.evmWallet.switchChain(4663) } catch { /* already on chain */ }
  const provider = await auth.evmWallet.getEthereumProvider()
  const send = async (to, data) => { const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: evm, to, data, value: '0x0' }] }); await rhClient.waitForTransactionReceipt({ hash }); return hash }
  const allowance = await rhClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'allowance', args: [evm, SWAP_ROUTER] })
  if (allowance < amountWei) await send(tokenAddress, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SWAP_ROUTER, MAX_UINT] }))
  await send(SWAP_ROUTER, encodeFunctionData({ abi: routerAbi, functionName: 'exactInputSingle', args: [{ tokenIn: tokenAddress, tokenOut: WETH_ADDR, fee: POOL_FEE, recipient: evm, amountIn: amountWei, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }))
  const wbal = await rhClient.readContract({ address: WETH_ADDR, abi: wethAbi, functionName: 'balanceOf', args: [evm] })
  if (wbal > 0n) await send(WETH_ADDR, encodeFunctionData({ abi: wethAbi, functionName: 'withdraw', args: [wbal] }))
  return { sold: amountWei.toString() }
}

// ---- FUND: send SOL from the admin's Phantom to each buyer wallet (batched) ----
export async function fundWallets(auth, targets) {
  const conn = new Connection(SOLANA_RPC)
  const from = new PublicKey(auth.solana)
  const valid = targets.filter((t) => Number(t.sol) > 0)
  if (!valid.length) throw new Error('Set a SOL amount to fund')
  const sigs = []
  for (let i = 0; i < valid.length; i += 16) {
    const batch = valid.slice(i, i + 16)
    const tx = new Transaction()
    batch.forEach((t) => tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(t.pubkey), lamports: Math.floor(Number(t.sol) * LAMPORTS_PER_SOL) })))
    tx.feePayer = from
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
    sigs.push(await auth.primaryWallet.sendTransaction(tx, conn))
  }
  return sigs
}

// ---- BRIDGE: the twin's Robinhood-Chain ETH (from sells) -> SOL, via Relay ----
// SOL lands back in this slot's own Solana buyer wallet so it can be swept out.
const ETH_GAS_BUFFER = 300000000000000n // 0.0003 ETH kept for the deposit-tx gas
// bridge a twin's ETH -> SOL. Default recipient is the twin's own Solana buyer;
// pass solRecipient to send straight somewhere else (e.g. the dev Phantom).
export async function bridgeEvmToSol(slot, solRecipient) {
  const recipient = solRecipient || slot.solPubkey
  const account = privateKeyToAccount(slot.evmPk)
  const wallet = createWalletClient({ account, chain: RH, transport: http() })
  const ethBal = await rhClient.getBalance({ address: slot.evmAddress })
  if (ethBal <= ETH_GAS_BUFFER) throw new Error('No ETH to bridge')
  const amountWei = ethBal - ETH_GAS_BUFFER
  const q = await fetch(`${API}/api/quote/bridge?ethWei=${amountWei}&evmAddress=${slot.evmAddress}&solanaRecipient=${recipient}`).then((r) => r.json())
  if (!q.steps) throw new Error(q.message || q.error || 'Bridge quote failed')
  for (const step of q.steps) for (const item of step.items) {
    if (!item.data || !item.data.to) continue
    const hash = await wallet.sendTransaction({ to: item.data.to, value: item.data.value ? BigInt(item.data.value) : 0n, data: item.data.data ?? '0x' })
    await rhClient.waitForTransactionReceipt({ hash })
  }
  return { bridged: amountWei.toString() }
}

// bridge the DEV wallet's ETH (Privy embedded, launch creator) -> SOL at solRecipient
export async function bridgeDevToSol(auth, solRecipient) {
  const evm = auth.evmAddress
  if (!evm) throw new Error('Dev wallet not ready')
  const ethBal = await rhClient.getBalance({ address: evm })
  if (ethBal <= ETH_GAS_BUFFER) throw new Error('No ETH to bridge')
  const amountWei = ethBal - ETH_GAS_BUFFER
  const q = await fetch(`${API}/api/quote/bridge?ethWei=${amountWei}&evmAddress=${evm}&solanaRecipient=${solRecipient}`).then((r) => r.json())
  if (!q.steps) throw new Error(q.message || q.error || 'Bridge quote failed')
  try { await auth.evmWallet.switchChain(4663) } catch { /* already on chain */ }
  const provider = await auth.evmWallet.getEthereumProvider()
  for (const step of q.steps) for (const item of step.items) {
    if (!item.data || !item.data.to) continue
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: evm, to: item.data.to, value: item.data.value ? '0x' + BigInt(item.data.value).toString(16) : '0x0', data: item.data.data || '0x' }] })
    await rhClient.waitForTransactionReceipt({ hash })
  }
  return { bridged: amountWei.toString() }
}

// ---- WITHDRAW: sweep leftover SOL from a buyer wallet back to a destination ----
export async function sweepSol(slot, toPubkey) {
  const conn = new Connection(SOLANA_RPC)
  const bal = await conn.getBalance(new PublicKey(slot.solPubkey))
  const lamports = bal - 5000 // leave the network fee
  if (lamports <= 0) return null
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(slot.solPubkey), toPubkey: new PublicKey(toPubkey), lamports }))
  tx.feePayer = new PublicKey(slot.solPubkey)
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  tx.sign(Keypair.fromSecretKey(bs58.decode(slot.solSecret)))
  return conn.sendRawTransaction(tx.serialize())
}

export const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '')
export const isSolAddress = (a) => { try { new PublicKey(a); return true } catch { return false } }

/* ============================================================
   FUNDER panel — bulk-fund EVM wallets with ETH via Relay so each
   lands funded by the Relay solver (unlinked on Robinhood Chain).
   Solana "funders" (each fed from a CEX like Coinbase) pay for the
   bridges; pairing them 1:1 with EVM wallets avoids a shared source.
   ============================================================ */
const FUNDER_KEY = 'hl_funder_sol'   // Solana wallets that hold SOL and pay for bridges
const TARGET_KEY = 'hl_funder_evm'   // EVM wallets to receive ETH (+ maybe trade from)
export const loadFunders = () => { try { return JSON.parse(localStorage.getItem(FUNDER_KEY)) || [] } catch { return [] } }
export const saveFunders = (x) => localStorage.setItem(FUNDER_KEY, JSON.stringify(x))
export const loadTargets = () => { try { return JSON.parse(localStorage.getItem(TARGET_KEY)) || [] } catch { return [] } }
export const saveTargets = (x) => localStorage.setItem(TARGET_KEY, JSON.stringify(x))

export function newFunder() { const kp = Keypair.generate(); return { id: kp.publicKey.toBase58(), pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) } }
export function importFunder(input) {
  const s = input.trim()
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s)
  const kp = Keypair.fromSecretKey(bytes)
  return { id: kp.publicKey.toBase58(), pubkey: kp.publicKey.toBase58(), secret: bs58.encode(kp.secretKey) }
}

export function newEvmTarget() { const pk = generatePrivateKey(); const a = privateKeyToAccount(pk); return { id: a.address.toLowerCase(), address: a.address, pk, amount: '' } }
// accept an EVM private key (0x + 64 hex -> we can also trade/export) OR a bare address (fund-only)
export function importEvmTarget(input) {
  const s = input.trim().replace(/^["']|["']$/g, '') // tolerate stray quotes
  const pk = s.match(/^(?:0x)?([0-9a-fA-F]{64})$/) // private key, with or WITHOUT 0x (MetaMask omits it)
  if (pk) { const key = '0x' + pk[1]; const a = privateKeyToAccount(key); return { id: a.address.toLowerCase(), address: a.address, pk: key, amount: '' } }
  const addr = s.match(/^(?:0x)?([0-9a-fA-F]{40})$/) // bare address, with or without 0x
  if (addr) { const address = '0x' + addr[1]; return { id: address.toLowerCase(), address, amount: '' } }
  throw new Error('bad')
}

// bridge SOL -> Robinhood Chain ETH from a funder to an EVM address (signed by the funder)
export async function fundEvm(funder, evmAddress, solAmount) {
  const lamports = Math.floor(Number(solAmount) * LAMPORTS_PER_SOL)
  if (!(lamports > 0)) throw new Error('Amount must be > 0')
  const q = await fetch(`${API}/api/quote/fund?lamports=${lamports}&solanaAddress=${funder.pubkey}&evmRecipient=${evmAddress}`).then((r) => r.json())
  if (!q.steps) throw new Error(q.message || q.error || 'Quote failed')
  const conn = new Connection(SOLANA_RPC)
  const tx = new Transaction()
  q.steps.forEach((s) => s.items.forEach((it) => (it.data.instructions || []).forEach((ins) => tx.add(new TransactionInstruction({
    programId: new PublicKey(ins.programId),
    keys: ins.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: hexToBytes(ins.data),
  })))))
  tx.feePayer = new PublicKey(funder.pubkey)
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash
  tx.sign(Keypair.fromSecretKey(bs58.decode(funder.secret)))
  const sig = await conn.sendRawTransaction(tx.serialize())
  const check = q.steps[0].items[0].check
  for (let i = 0; i < 45; i++) {
    await sleep(2000)
    const st = await fetch(RELAY + check.endpoint).then((r) => r.json()).catch(() => ({}))
    if (st.status === 'success') return { sig, filled: true }
    if (st.status === 'failure' || st.status === 'refund') throw new Error('Relay ' + st.status)
  }
  return { sig, filled: false }
}

// both private keys for one slot, for export/backup
export const slotKeys = (s) => ({ solanaAddress: s.solPubkey, solanaPrivateKey: s.solSecret, evmAddress: s.evmAddress, evmPrivateKey: s.evmPk })

// merge an imported backup into the current pool (dedupe by id/pubkey, keep valid slots only)
export function mergeSlots(existing, incoming) {
  const byId = new Map(existing.map((s) => [s.id, s]))
  for (const s of incoming || []) {
    if (s && s.solPubkey && s.solSecret && s.evmAddress && s.evmPk) {
      const id = s.id || s.solPubkey
      byId.set(id, { snipeSol: '', ...s, id })
    }
  }
  return [...byId.values()]
}

// trigger a browser download of a JSON backup
export function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
