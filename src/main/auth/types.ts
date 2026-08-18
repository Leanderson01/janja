export const AUTH_CHANNELS = {
  SIGN_IN: 'auth:sign-in',
  SIGN_OUT: 'auth:sign-out',
  GET_USER: 'auth:get-user',
  GET_ACCESS_TOKEN: 'auth:get-access-token',
  ON_AUTH_CHANGE: 'auth:on-auth-change'
} as const

export interface AuthUser {
  workosId: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

export interface AuthIpcResult {
  success: boolean
  error?: string
}
