import { useEffect, useState } from 'react'
import { usePrivy, useSolanaWallets, useLogin, useWallets } from '@privy-io/react-auth'
import { API } from './api'

// Central auth hook: exposes the logged-in Solana address, Privy access token,
// and our backend profile (username/avatar). Registers the profile on login.
export function useAuth() {
  const { ready, authenticated, user, logout, getAccessToken, exportWallet } = usePrivy()
  // useLogin surfaces the precise failure reason, which the bare usePrivy().login
  // swallows into the modal's generic "Error authenticating session".
  const { login } = useLogin({
    onComplete: ({ user, isNewUser, loginMethod }) =>
      console.log('PRIVY_LOGIN_OK', { isNewUser, loginMethod, user }),
    onError: (error) =>
      console.error('PRIVY_LOGIN_ERROR', error, JSON.stringify(error)),
  })
  const { wallets } = useSolanaWallets()
  const { wallets: evmWallets } = useWallets()
  const [token, setToken] = useState(null)
  const [profile, setProfile] = useState(null)

  const solana =
    wallets?.[0]?.address ||
    user?.linkedAccounts?.find((a) => a.type === 'wallet' && a.chainType === 'solana')?.address ||
    null

  // the silent embedded EVM wallet (Privy) — holds the user's Robinhood Chain
  // tokens and signs sells. Prefer the embedded (walletClientType 'privy').
  const evmWallet = evmWallets?.find((w) => w.walletClientType === 'privy') || evmWallets?.[0] || null
  const evmAddress = evmWallet?.address || null

  useEffect(() => {
    let cancelled = false
    async function sync() {
      if (!authenticated || !solana) {
        setToken(null)
        setProfile(null)
        return
      }
      const t = await getAccessToken()
      if (cancelled) return
      setToken(t)
      const res = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t, 'x-solana-address': solana },
      })
      if (res.ok && !cancelled) setProfile((await res.json()).profile)
    }
    sync()
    return () => { cancelled = true }
  }, [authenticated, solana])

  return { ready, authenticated, solana, token, profile, setProfile, login, logout, primaryWallet: wallets?.[0], evmAddress, evmWallet, exportWallet }
}
