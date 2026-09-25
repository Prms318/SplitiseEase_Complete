export type ApiUser = {
  id: string
  email: string
  display_name: string
  is_pro: boolean
  is_platform_admin?: boolean
}

export type ApiSession = {
  access_token: string
  refresh_token: string
  expires_in: number
  user: ApiUser
}

export type ApiGroup = {
  id: string
  name: string
  kind: 'group' | 'friend'
  currency: string
  member_count: number
  created_at: string
}

export type ApiGroupMember = {
  user_id: string
  display_name: string
  role: 'owner' | 'admin' | 'member'
}

export type ApiBalance = {
  user_id: string
  net_minor: number
}

export type ApiSplit = {
  user_id: string
  owed_minor: number
}

export type ApiExpense = {
  id: string
  group_id: string
  description: string
  amount_minor: number
  currency: string
  paid_by_user_id: string
  split_method: 'equal' | 'exact'
  occurred_at: string
  created_at: string
  client_mutation_id: string
  splits: ApiSplit[]
}

export type ApiSettlement = {
  id: string
  status: string
  amount_minor: number
  currency: string
}

const apiBase = import.meta.env.VITE_API_BASE_URL || ''
const sessionStorageKey = 'splitease-api-session'
let activeSession: ApiSession | null = loadSession()

function loadSession(): ApiSession | null {
  try {
    const saved = sessionStorage.getItem(sessionStorageKey)
    return saved ? JSON.parse(saved) as ApiSession : null
  } catch {
    return null
  }
}

export function getSession(): ApiSession | null {
  return activeSession
}

export function setSession(session: ApiSession | null): void {
  activeSession = session
  if (session) sessionStorage.setItem(sessionStorageKey, JSON.stringify(session))
  else sessionStorage.removeItem(sessionStorageKey)
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}

async function readError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`
  try {
    const body = await response.json() as { detail?: unknown; message?: unknown }
    if (typeof body.detail === 'string') message = body.detail
    else if (typeof body.message === 'string') message = body.message
  } catch {
    // Keep the generic status message for non-JSON errors.
  }
  return new ApiError(message, response.status)
}

async function request<T>(path: string, init: RequestInit = {}, retryWithRefresh = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (activeSession?.access_token) headers.set('Authorization', `Bearer ${activeSession.access_token}`)

  const response = await fetch(`${apiBase}${path}`, { ...init, headers })
  if (response.status === 401 && retryWithRefresh && activeSession?.refresh_token && path !== '/auth/refresh') {
    const refreshed = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: activeSession.refresh_token }),
    })
    if (!refreshed.ok) {
      setSession(null)
      throw await readError(refreshed)
    }
    setSession(await refreshed.json() as ApiSession)
    return request<T>(path, init, false)
  }

  if (!response.ok) throw await readError(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function jsonBody(body: unknown): string {
  return JSON.stringify(body)
}

export const api = {
  async login(email: string, password: string): Promise<ApiSession> {
    const session = await request<ApiSession>('/auth/login', {
      method: 'POST',
      body: jsonBody({ email, password }),
    }, false)
    setSession(session)
    return session
  },

  async register(email: string, password: string, displayName: string): Promise<ApiSession> {
    const session = await request<ApiSession>('/auth/register', {
      method: 'POST',
      body: jsonBody({ email, password, display_name: displayName }),
    }, false)
    setSession(session)
    return session
  },

  async acceptInvitation(token: string, password: string): Promise<ApiSession> {
    const session = await request<ApiSession>('/auth/accept-invitation', {
      method: 'POST',
      body: jsonBody({ token, password }),
    }, false)
    setSession(session)
    return session
  },

  async currentUser(): Promise<ApiUser> {
    return request<ApiUser>('/auth/me')
  },

  async logout(): Promise<void> {
    if (activeSession?.refresh_token) {
      await request<void>('/auth/logout', {
        method: 'POST',
        body: jsonBody({ refresh_token: activeSession.refresh_token }),
      })
    }
    setSession(null)
  },

  get<T>(path: string): Promise<T> {
    return request<T>(path)
  },

  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: jsonBody(body) })
  },

  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: jsonBody(body) })
  },

  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' })
  },
}
