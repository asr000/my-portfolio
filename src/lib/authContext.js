import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('账号状态尚未初始化。')
  return value
}

export function isSessionError(error) {
  return (
    error?.status === 401 ||
    error?.name === 'AuthSessionMissingError' ||
    [
      'bad_jwt',
      'session_not_found',
      'session_expired',
      'refresh_token_not_found',
      'refresh_token_already_used',
    ].includes(error?.code)
  )
}
