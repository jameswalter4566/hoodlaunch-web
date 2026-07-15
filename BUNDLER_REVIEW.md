# Admin Bundler — button-by-button logic map & verification notes

Live at `/admin/launch/:address` (PIN-gated). Every button below is wired to a function in
`src/lib/bundler.js` (the engine) or a handler in `src/pages/AdminBundler.jsx`. This maps each
one so you can fact-check the logic.

## Files
- `src/lib/bundler.js` — all wallet + trade logic (buy/sell/fund/sweep/balances).
- `src/pages/AdminBundler.jsx` — the terminal UI + button handlers.
- `src/pages/WalletStrip.jsx` — pre-launch setup on `/admin` launch panel; snipes on launch.
- `src/components/AdminGate.jsx` — shared PIN gate (also now used by `/admin`).
- `src/bundler.css` — terminal styles.

## Wallet model (recap)
Each **slot** = a Solana buyer keypair `S_i` + an EVM twin `E_i` (both generated/stored in
`localStorage['hl_bundle_pool']`, this browser only). **Buys** go through Relay (SOL from `S_i`
→ tokens delivered to `E_i`) — identical footprint to a real user. **Sells** are native
Robinhood-Chain swaps signed by `E_i`'s key via viem.

## Buttons — what each does + how it's verified

| Button | Handler → engine fn | Logic | Verified |
|---|---|---|---|
| **+ Create Wallets** (count N) | `createWallets` → `B.newSlot()` ×N | generate N {Solana kp + EVM twin}, save to pool | ✅ live: created 3, keys stored, rows render |
| **Import Wallets** (paste keys) | `importWallets` → `B.importSlot()` | parse Solana key (base58 or `[…]`), mint fresh EVM twin, dedupe | ✅ parser Node-tested (roundtrip + junk reject) |
| **Fund N SOL ea** | `fundAll` → `B.fundWallets()` | Phantom sends N SOL to each `S_i`, batched 16/tx | ⚠️ needs Phantom — logic mirrors existing buy-signing |
| **↻ refresh** | `refresh` → `B.walletStates()` | 1 totalSupply read + SOL/token/ETH per slot | ✅ live: balances populated (0.000 SOL, 0.00%) |
| **Withdraw SOL** (top) | `withdrawAll` → `B.sweepSol()` | each `S_i` sends its SOL (−fee) back to your Phantom | ⚠️ needs funded wallet; same signing as buy |
| **Copy ⧉ fund** (per row) | `copy(s.solPubkey)` | copies the Solana buyer address to fund it | ✅ trivial clipboard |
| **Buy 25/50/75/100%** (row, green) | `doBuyPct` → `B.buyPct` → `B.buy` | spend that % of `S_i` SOL on a Relay buy → `E_i` | ✅ Relay quote verified live w/ real slot keys |
| **Sell 25/50/75/100%** (row, red) | `doSell` → `B.sellPct` | sell that % of `E_i` tokens: gas topup → approve → swap → unwrap | ⚠️ signing mirrors live sell button; RH reads verified |
| **Buy tab → Buy all wallets** | `buyAll` → `doBuy` ×N (staggered, parallel) | each slot buys `aggSol` SOL via Relay | ✅ same buy path; parallel OK (independent wallets) |
| **Sell tab → Sell % all** | `sellAll` → `doSell` **serialized** | sell % from every slot, one at a time | ⚠️ serialized to avoid treasury-nonce races (see note) |
| **Holders presets** | `sellAll(p)` | sell p% across all bundle wallets | same as Sell-all |
| **Deployer presets** | `doSellDev` → `B.sellDev` | sell % of the launch/dev wallet (Privy-signed) | ⚠️ mirrors live sell exactly |
| **🔴 Nuke** | `nuke` → `sellAll(100)` then `doSellDev(100)` | dump everything, awaited in order | serialized, safe |
| **🔑 export** (row) | `exportKeys` | copies `{solana, evm, evmAddress}` JSON | ✅ trivial |
| **✕ remove** (row) | `removeSlot` | confirm → drop slot from pool | ✅ trivial |
| **Public page ↗** | `Link /coin/:address` | opens the normal public token page | ✅ |

## Snipe-on-launch (pre-launch, `/admin` panel)
`WalletStrip` manages the same pool; set each wallet's **SOL snipe** amount + fund via the
copy button. On a successful Robinhood-Chain launch, `AdminLaunch.launch()` calls
`bundleRef.current.fire(address)` → each funded wallet fires its Relay buy (staggered), then
redirects to `/admin/launch/:address`.

## Concurrency notes (reviewed)
- **Buys run parallel** — each is a different Solana wallet, no shared state. Safe.
- **Sells run serial** — every sell triggers a gas top-up from the *single treasury wallet*;
  parallel top-ups would collide on the treasury nonce. `sellAll`/`nuke` await each in turn.
  (Rapid manual per-row sell clicks across wallets have a small residual race; top-up is
  balance-guarded so it's low-risk.)

## What could NOT be runtime-tested without funds (do a small real test first)
1. A **real buy** end-to-end (fund one wallet with ~0.02 SOL, click its Buy 25%). The Relay
   *quote* is verified live; only the sign+submit+fill is untested with real SOL.
2. A **real sell** (after a buy lands, click Sell 100%). The sign path uses viem with the
   twin's key — identical to the server's proven `createWalletClient(...).sendTransaction`.
3. **Fund / Withdraw** (need Phantom connected).

## Privacy
Nothing server-side flags the token as an admin launch; it appears normal on `/coin`. The
slot↔token link lives only in this browser's `localStorage`. On-chain the wallets are ordinary
addresses whose buys go through Relay exactly like real users.

## Known future adds (not blocking)
- Cash out `E_i` ETH (from sells) → SOL via Relay bridge (currently ETH sits in the twin).
- Bulk "Fund all" on the pre-launch `WalletStrip` (today: copy-address + manual send there).
- Amount jitter on snipe for extra realism (stagger already in).
