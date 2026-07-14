import { useEffect, useState } from 'react'
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth'
import { API } from './api'

// Central auth hook: exposes the logged-in Solana address, Privy access token,
// and our backend profile (username/avatar). Registers the profile on login.
export function useAuth() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useSolanaWallets()
  const [token, setToken] = useState(null)
  const [profile, setProfile] = useState(null)

  const solana =
    wallets?.[0]?.address ||
    user?.linkedAccounts?.find((a) => a.type === 'wallet' && a.chainType === 'solana')?.address ||
    null

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

  return { ready, authenticated, solana, token, profile, setProfile, login, logout, primaryWallet: wallets?.[0] }
}
