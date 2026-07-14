export const API = 'https://hoodlaunchbackend-production.up.railway.app'
export const EXPLORER = 'https://robinhoodchain.blockscout.com'
export const RELAY = 'https://api.relay.link'

export async function getJSON(path) {
  const r = await fetch(API + path)
  if (!r.ok) throw new Error('request failed: ' + path)
  return r.json()
}

// auth-scoped fetch using the Privy token + the user's Solana address
export async function authFetch(path, token, solana, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      'x-solana-address': solana,
      ...(opts.headers || {}),
    },
  })
}

export function usd(eth, ethUsd, digits = 2) {
  if (!ethUsd) return (eth || 0).toExponential(2) + ' ETH'
  const n = eth * ethUsd
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'
  return '$' + n.toFixed(digits)
}

export function fmtAge(iso) {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}

export function shortAddr(a) {
  return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''
}

let ethUsdCache = { v: 0, at: 0 }
export async function ethUsd() {
  if (Date.now() - ethUsdCache.at < 60000 && ethUsdCache.v) return ethUsdCache.v
  try {
    const p = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then((r) => r.json())
    ethUsdCache = { v: Number(p.data.amount), at: Date.now() }
  } catch {}
  return ethUsdCache.v
}
