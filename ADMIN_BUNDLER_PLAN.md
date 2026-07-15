# Admin Bundler — `/admin/launch/:address` Multi-Wallet Trading Terminal

**Status: PLAN ONLY — not built.** Study doc modeled on the Photon/proxima-style bundler
screenshot (photo_2026-07-15). Everything below is grounded in the existing
`Token.jsx` trade code, `AdminLaunch.jsx` launch flow, and the Relay/Robinhood-Chain
mechanics already in the repo.

---

## 0. Goal

Every admin launch gets a private, per-coin bundler terminal at
`/admin/launch/:address`. It holds many **independent wallets** that each place their
own **organic, native on-chain buys/sells** of that token — so on the public token page
the launch looks like a crowd of separate traders, not one bot. The panel lets the admin
create/import/fund wallets, snipe on launch, and afterward buy more or sell any % from
each wallet individually or in aggregate.

**Hard constraints**
- Each buy comes from a **separate wallet** → shows as a distinct trade / distinct holder.
- The bundler UI is **only** on `/admin/launch/:address` (PIN-gated). 
- The token appears on the **public** site as a totally normal token. **Nothing** server-side
  may flag it as an admin launch — the token↔wallets link lives only in admin localStorage.
- Each admin launch is tracked **separately** (per-coin wallet set + state).

---

## 1. Wallet model — LOCKED (dual wallet per slot: Solana buyer + EVM holder/seller)

**Decision (James, firm): buys MUST go through Relay**, exactly like a real user on the
public site. That is the point of the whole feature — a Relay buy is byte-for-byte the same
footprint as an organic user buy (SOL deposit on Solana → aged Relay solver fills on
Robinhood Chain → tokens to a recipient). A native ETH→token swap from a fresh EOA is a
*different, identifiable* pattern and is rejected. So each buy bridges at launch — the
bridge **is** the organic buy.

**Each bundler slot = TWO keypairs created/imported together:**
- **`S_i` — a Solana keypair (the buyer).** Holds SOL; signs the Relay buy. This is the
  funds source, mirroring a real user's Phantom wallet.
- **`E_i` — an EVM keypair on Robinhood Chain (the holder + seller).** The Relay buy's
  `recipient` is `E_i`, so bought tokens land here; `E_i` later signs its own native sells.
  Mirrors a real user's Privy embedded EVM wallet — except WE hold the key, so no Privy.

Why this is consistent (not the mismatch I first feared): our indexer attributes a trade's
`trader` to the Swap **recipient** (`indexer.ts handleSwapLog`, line 214). The Relay buy's
recipient is `E_i`, so in our own feed `E_i` shows as the **buyer**, and later as the
**seller** — same address, a normal-looking trader. Externally, the footprint also matches a
real user: Relay-submitted buy (aged solver as tx sender), self-submitted native sell. Both
views are clean.

- **Create Wallets**: generate N `{S_i, E_i}` pairs (`Keypair.generate()` for Solana;
  viem `generatePrivateKey` → `privateKeyToAccount` for EVM).
- **Import Wallets**: paste a Solana private key (base58 / JSON array) for `S_i`; generate a
  fresh `E_i` alongside it. (EVM twin is always ours so we can sign sells.)
- **Signing**: Solana buy → sign with `S_i` keypair + `sendRawTransaction` (as WalletStrip
  does today). EVM sell → `createWalletClient({ account: privateKeyToAccount(E_i.pk), chain: RH,
  transport: http() })` → `writeContract`. No Privy anywhere.
- **Storage**: localStorage, namespaced per coin so each launch is separate:
  - `hl_bundle_<coinAddressLower>` = `[{ id, label, solPubkey, solSecret, evmAddress, evmPk }]`
  - Reusable pool `hl_bundle_pool` to attach the same slots to a new launch.
  - ⚠️ Raw keys in plaintext localStorage, admin browser only. Same trust model as the
    existing `hl_admin_wallets`. Never send keys to the server.

---

## 2. Buy / sell / fund mechanics

Reuse the constants + client already in `Token.jsx`: `rhClient` (viem public client, RH chain),
`SWAP_ROUTER 0xCaf6…5cb2`, `WETH_ADDR 0x0Bd7…AD73`, `POOL_FEE 10000`, `erc20Abi`,
`routerAbi (exactInputSingle, payable)`, `wethAbi`, `MAX_UINT`. Reuse the buy path from
`Token.jsx buy()` and `/api/quote/buy`.

### Buy (Relay SOL → token) — the organic leg, signed by `S_i`
Identical to the public user buy, just signed by our Solana keypair instead of Phantom:
1. `GET /api/quote/buy?token=<addr>&lamports=<n>&solanaAddress=<S_i.pubkey>&evmRecipient=<E_i.evmAddress>`
2. Build the Solana tx from `quote.steps` instructions; `feePayer = S_i.pubkey`.
3. `tx.sign(S_i keypair)` → `conn.sendRawTransaction` (no Phantom prompt).
4. Poll `RELAY + steps[0].items[0].check.endpoint` until `success`.
- Relay's aged solver fills on Robinhood Chain and delivers tokens to `E_i` → same footprint
  as a real user buy. ~2s cross-chain; buys fire in parallel across slots at launch.
- Buy amount per slot set in **SOL** (matches the public UX and the SOL these wallets hold).

### Sell (native token → WETH → ETH) — signed by `E_i`, reuse `Token.jsx sell()`
1. `balanceOf(E_i)` → `amountWei = bal * pct/100`
2. **gas top-up**: `POST /api/gas/topup { evmAddress: E_i }` — `E_i` holds tokens but no ETH
   for gas after a buy; the treasury dusts it (this endpoint already exists and is idempotent).
3. `approve(SWAP_ROUTER, MAX_UINT)` once (skip if allowance ≥ amount)
4. `exactInputSingle(token→WETH, recipient=E_i)` via viem walletClient(E_i)
5. `WETH.withdraw(wbal)` → native ETH in `E_i`
- Consistent trader: `E_i` was the buy recipient and is now the seller.

### Fund Wallets
- **Fund the buyers (`S_i`)**: send SOL to each `S_i` — this is the buying power. Copy-address
  per row (already built) + a bulk "Fund" that splits SOL from the admin's Phantom across all
  `S_i`. This is the only funding needed to buy.
- **Gas for sellers (`E_i`)**: handled on demand by `/api/gas/topup` at sell time — no manual
  pre-fund. (Optional: pre-dust all `E_i` in one pass.)
- **Withdraw / collect**: sweep — sell-all then bridge ETH→SOL back to one Phantom (via
  `/api/quote/bridge`), and/or sweep leftover SOL from the `S_i` wallets.

---

## 3. Launch → snipe wiring

`AdminLaunch.launch()` already resolves the new token `address`. Change the post-launch hook:
1. On successful launch, **redirect to `/admin/launch/:address`** (instead of the public
   `/coin/:address`) — so the admin lands in the bundler.
2. Auto-fire the snipe: every slot with a set SOL buy amount fires its Relay buy in parallel
   (`S_i` pays SOL → recipient `E_i`). N independent Relay fills = N organic buys. Only the
   `S_i` wallets need to be pre-funded with SOL (done BEFORE launch); `E_i` needs nothing to
   receive.
3. Optional **jitter/stagger** (see decisions): randomize buy sizes and spread fires across a
   few seconds so it isn't N identical simultaneous buys.
4. Pre-launch checklist in the panel: slots created ✓, `S_i` funded with SOL ✓, buy amounts set ✓.

---

## 4. Route & gating

- New route `/admin/launch/:address` → `<AdminBundler>` (new page).
- **Gate identically to `/admin`**: reuse the `sessionStorage 'adm' === '1'` check; if not
  authed, render the same PIN form (or redirect to `/admin`). Factor the PIN gate out of
  `Admin.jsx` into a small `useAdminAuth()` / `<AdminGate>` wrapper so both pages share it.
- Add `<AdminLaunch>`'s "go to bundler" navigation. Public `/coin/:address` stays unchanged
  and public; the token is indistinguishable from any other there.

---

## 5. UI breakdown — every element of the reference image

### Top bar
- Token identity: logo, `$SYMBOL Name`, contract (copy), age, V3 badge, X/socials link.
- Stats tiles: **Mcap**, **Price**, **Circulating** (from `/api/tokens/:address` + supply).
- **Buys N/$ · 1h Vol · Sells N/$** counters with green/red bars — from `/api/tokens/:address/trades`
  (already exists; `Token.jsx` computes day buys/sells the same way).
- Right: **Withdraw ▾** (sweep ETH from wallets) + total ETH/$ across the set + save/settings.

### Chart (left, ~70%)
- Reuse `Token.jsx` lightweight-charts candles from `/api/tokens/:address/candles` (USD via
  Coinbase spot). Timeframe row `5y 1y 3m 1m 5d 1d`, log/auto.
- Bubbles / trade markers (DB=dev buy, S=sell, DS=dev sell, "Average Sell Price" line) =
  **Phase 2 polish** — overlay markers from our own trades table keyed to our wallet set.
- Right-of-chart live trades ladder (`ETH | MCap | Trader | Age`) = `/trades` stream; tag rows
  whose Trader ∈ our wallet set.

### Right trade panel (~25%)
- **Buy / Sell** tabs (aggregate action across selected wallets).
- **Holders** quick-sell: `% SUPPLY` presets `0.1% 0.5% 1% 5% MAX` — sell that % of *total held*
  spread across wallets.
- **Deployer** quick-sell: same, targeting the dev/deployer wallet only.
- Stats: **Bought · Sold · Holding · uP&L** (ETH) — aggregate across the set, computed from
  balances + our trade log.
- Action icons: send / buyback-fire / wallet-manager.
- **Nuke – N ETH** (red): sell 100% from *every* wallet in one sweep → the big panic-exit.

### Bottom multi-wallet panel — THE CORE
- Tabs: **My Wallets** | Latest Trades | Holders | History | Bubble Maps.
- Toolbar: **Aggregate** toggle, **+ Create Wallets**, **Import Wallets**, **Fund Wallets**.
- Each row is a **slot** (`S_i` buyer + `E_i` holder). Columns: **# | Wallet | SOL (buyer
  balance) | Supply % | Token Balance ($) | [Buy presets] | [Sell presets] | Actions**.
  - **Wallet cell**: show `E_i` (the on-chain identity/trader) as the address; the copy
    button copies **`S_i`** (so you fund the buyer with SOL). A small badge links `S_i`↔`E_i`.
  - **SOL** = `S_i` balance (`conn.getBalance`) — the buying power. **Supply % / Token Balance**
    = `E_i`'s `balanceOf(token)` ÷ `totalSupply`.
  - **Buy presets (green) `25% 50% 75% 100%`** = spend that % of `S_i`'s SOL on a Relay buy
    (recipient `E_i`).
  - **Sell presets (red) `25% 50% 75% 100%`** = sell that % of `E_i`'s token holdings natively.
  - Per-row Actions: fund `S_i`, export keys, remove, "…" menu.
- Row 1 = **Dev / deployer** slot (crown icon) — the launch creator wallet.
- Footer totals: **Total: N Wallets + Dev**, aggregate Supply %, aggregate SOL + token value.
- Balances: `conn.getBalance(S_i)` (SOL), `rhClient.readContract balanceOf(token, E_i)` +
  `totalSupply`. Poll on an interval + after each action.

---

## 6. Data & privacy

- **No schema changes** to public tables. The token row the indexer writes is normal.
- Bundler state (wallet set, per-coin) is **client-only** localStorage. If we ever want it to
  survive across browsers, a *separate* admin-only table keyed by coin+PIN — never joined to
  the public token API. Default: localStorage only.
- On-chain, the wallets are ordinary EVM addresses; their trades are real Uniswap swaps
  indistinguishable from any trader. That *is* the privacy model.

---

## 7. Build order

1. **Foundation**: `<AdminGate>` shared PIN wrapper; `/admin/launch/:address` route; page
   scaffold (top bar + reused chart + empty wallet table).
2. **Wallet manager**: Create/Import/Fund/Withdraw; per-coin localStorage; live ETH + token
   balances + supply%; totals footer.
3. **Trading**: per-wallet native buy (ETH→token) + sell (%). Green/red presets. viem
   walletClient signing with raw keys.
4. **Aggregate + snipe**: right panel aggregate Buy/Sell, Holders/Deployer quick-sell, Nuke;
   wire `AdminLaunch` to redirect here + auto-snipe funded wallets on launch.
5. **Polish**: live trades ladder with own-wallet tagging, chart bubbles/markers, uP&L,
   1h vol counters, per-wallet labels/colors.

---

## 8. Open decisions (need James's call)

RESOLVED: buys go through **Relay** (SOL→token, recipient = paired EVM wallet) — mandatory,
to match the real-user footprint. Sells are native from the EVM twin. (§1)

Still open:
1. **Wallet count cap?** Image shows "39 Wallets + Dev". Each slot = one SOL wallet to fund +
   one Relay fill at launch; scales linearly (Relay fees + ~2s each, but parallel).
2. **Jitter/stagger** buy sizes + fire timing at launch for realism? (Recommended.)
3. **Reuse slot pool across launches** vs. fresh set per coin (fresh = cleaner separation).
4. **Import**: when importing a Solana buyer key, always generate a fresh EVM twin (default),
   or allow importing an existing EVM key as the twin too?
5. **Withdraw/collect target**: sell-all → bridge ETH→SOL back to one Phantom, and sweep
   leftover SOL from the `S_i` wallets to one address?
6. **Gas dust source** for `E_i` sells: rely on `/api/gas/topup` (treasury pays) per sell, or
   pre-dust all twins once? (Treasury topup already exists.)
