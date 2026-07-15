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

## 1. Wallet model (the core change vs. today's bundle strip)

Today's `WalletStrip` wallets are **Solana** keypairs that pay SOL via Relay and dump all
tokens into one shared EVM address. That can't produce independent holders. The new model:

**Each bundler wallet is an EVM keypair on Robinhood Chain (id 4663).** That EVM address
is the wallet's on-chain identity — the "Trader" in the trades table, a distinct holder,
and the signer of its own sells. This is what makes buys look organic.

- **Create Wallets**: generate N random EVM keypairs (viem `generatePrivateKey` →
  `privateKeyToAccount`).
- **Import Wallets**: paste EVM private key(s) (0x-hex), one per line → validate.
- **Signing**: raw keys, so **not** Privy. Use viem directly:
  `createWalletClient({ account: privateKeyToAccount(pk), chain: RH, transport: http() })`
  → `writeContract` / `sendTransaction`. Pure client-side, no backend key custody.
- **Storage**: localStorage, namespaced per coin so each launch is separate:
  - `hl_bundle_<coinAddressLower>` = `[{ id, label, evmAddress, pk }]`
  - A reusable global pool `hl_bundle_pool` so the same wallets can be attached to a new
    launch without re-importing.
  - ⚠️ Raw EVM private keys in plaintext localStorage, admin browser only. Same trust model
    as the existing `hl_admin_wallets`. Document it; never send keys to the server.

---

## 2. Buy / sell / fund mechanics (all native on Robinhood Chain)

Reuse the exact constants + client already in `Token.jsx`:
`rhClient` (viem public client, RH chain), `SWAP_ROUTER 0xCaf6…5cb2`,
`WETH_ADDR 0x0Bd7…AD73`, `POOL_FEE 10000`, `erc20Abi`, `routerAbi (exactInputSingle, payable)`,
`wethAbi`, `MAX_UINT`.

### Buy (native ETH → token) — NEW, replaces the Relay SOL buy for bundler
`exactInputSingle` is **payable**, so a wallet buys by swapping its own ETH in one tx:
```
walletClient.writeContract({
  address: SWAP_ROUTER, abi: routerAbi, functionName: 'exactInputSingle',
  args: [{ tokenIn: WETH_ADDR, tokenOut: token, fee: POOL_FEE, recipient: wallet.evmAddress,
           amountIn: ethWei, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }],
  value: ethWei,            // router wraps ETH→WETH→token internally
})
```
- Instant, single-chain, signed by the wallet's own key → independent on-chain buyer.
- No Relay, no cross-chain wait. Buy amount set per-wallet in ETH (or SOL-equiv via spot,
  matching current UX; internally ETH).

### Sell (token → WETH → ETH) — reuse `Token.jsx sell()` verbatim, per wallet
1. `balanceOf(wallet)` → `amountWei = bal * pct/100`
2. `approve(SWAP_ROUTER, MAX_UINT)` once (skip if allowance ≥ amount)
3. `exactInputSingle(token→WETH, recipient=wallet)`
4. `WETH.withdraw(wbal)` → native ETH back in the wallet
- Gas paid by the wallet's own ETH (RH chain has no paymaster).

### Fund Wallets (get ETH onto each wallet)
Wallets need ETH for buys + gas. Two funding sources (offer both):
- **A. Distribute from a funder** (MVP): admin's connected embedded EVM wallet (or a
  designated funder key) sends ETH to each wallet — a loop of `sendTransaction({to, value})`.
- **B. Bridge SOL → RH-ETH via Relay**: quote SOL(origin)→ETH(RH chain) to each wallet
  address (mirror of `/api/quote/bridge`, direction reversed), signed by the admin's Phantom.
  Lets the admin top up the whole set straight from SOL.
- Also a **Withdraw / collect** action (top-right in image): sweep ETH from all wallets back
  to a single address.

---

## 3. Launch → snipe wiring

`AdminLaunch.launch()` already resolves the new token `address`. Change the post-launch hook:
1. On successful launch, **redirect to `/admin/launch/:address`** (instead of the public
   `/coin/:address`) — so the admin lands in the bundler.
2. Auto-fire the snipe: every funded wallet with a set buy amount does its native ETH→token
   buy immediately (parallel `writeContract`s). Because they're independent EVM txs, they
   land as N separate buys within the first blocks. (Pre-funding in §2 must happen BEFORE
   launch so the ETH is already on-chain.)
3. Pre-launch checklist surfaced in the panel: wallets created ✓, funded ✓ (each ≥ buy+gas),
   buy amounts set ✓.

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
- Table columns: **# | Wallet (addr, copy, icons) | Supply % | Balance (ETH + $) |
  [Buy presets] | [Sell presets] | Actions**.
  - **Buy presets (green) `25% 50% 75% 100%`** = spend that % of the wallet's ETH on a native
    buy of the token.
  - **Sell presets (red) `25% 50% 75% 100%`** = sell that % of the wallet's token holdings.
  - Per-row Actions: fund this wallet, withdraw, copy key/export, remove, "…" menu.
- Row 1 = **Dev / deployer** wallet (crown icon) — the launch creator wallet.
- Footer totals: **Total: N Wallets + Dev**, aggregate Supply %, aggregate Balance.
- Balances: `rhClient.getBalance(wallet)` for ETH, `balanceOf(token, wallet)` for supply;
  supply % = `balanceOf / totalSupply`. Poll on an interval + after each action.

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

1. **Funding source**: distribute ETH from one funder wallet (needs an admin RH-ETH wallet),
   bridge from SOL via Relay per wallet, or both? (Plan assumes both, MVP = distribute.)
2. **Buy amount unit**: per-wallet input in **ETH** (native, exact) or **SOL** (converted via
   spot, matches current launch UX)? Image implies native ETH.
3. **Wallet count**: cap? Image shows "39 Wallets + Dev". Gas + funding scale linearly.
4. **Randomization for organic look**: jitter buy amounts / stagger timing by a few blocks so
   the snipe isn't N identical simultaneous buys? (Recommended for realism.)
5. **Reuse wallet pool across launches** vs. fresh set per coin (fresh = cleaner privacy).
6. **Withdraw target**: sweep all wallet ETH back to admin Phantom (via Relay→SOL) or to an
   RH-chain address?
