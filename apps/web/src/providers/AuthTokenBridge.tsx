import { useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { setAuthTokenGetter, setLogoutHandler } from '@/lib/api'

/**
 * Token bridge (PR2b W3). A render-null component mounted under `<PrivyProvider>`
 * that registers Privy's `getAccessToken` into the api.ts module-level getter on
 * mount (and clears it on unmount). This is the seam that lets the plain
 * `apiFetch` module function attach `Authorization: Bearer <jwt>` WITHOUT calling
 * a React hook in module scope (which is impossible) — registration bridges the
 * hook value into the module.
 *
 * `getAccessToken` is stable from Privy; we still re-register if it changes. On
 * unmount we clear the getter so a torn-down tree never leaves a dangling token
 * source.
 */
export function AuthTokenBridge() {
  const { getAccessToken, logout } = usePrivy()

  useEffect(() => {
    setAuthTokenGetter(getAccessToken)
    return () => setAuthTokenGetter(null)
  }, [getAccessToken])

  // W5: register Privy's logout so apiFetch can drop to the login screen when a
  // 401 survives a silent refresh + retry.
  useEffect(() => {
    setLogoutHandler(logout)
    return () => setLogoutHandler(null)
  }, [logout])

  return null
}
