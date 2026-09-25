import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Check, Clock3, Copy, Crown, Search, Shield, ShieldAlert, UserPlus, Users } from 'lucide-react'
import { api } from './api'
import './AdminPage.css'

type AdminUser = {
  id: string
  email: string
  display_name: string
  is_active: boolean
  is_pro: boolean
  pro_source: string | null
  active_pro_grant: { id: string; reason: string; expires_at: string | null; created_at: string } | null
  created_at: string
}

type AdminSummary = { users: number; active_users: number; pro_users: number; pending_invitations: number }
type AuditEntry = { id: string; actor_email: string; target_user_id: string | null; action: string; details: Record<string, unknown>; created_at: string }
type UserPage = { items: AdminUser[]; total: number; limit: number; offset: number }
type Invitation = { id: string; email: string; display_name: string; invite_token: string; expires_at: string }
type ReasonAction = 'suspend' | 'reactivate' | 'revoke_sessions' | 'revoke_grant'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed'
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users')
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteName, setInviteName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [grantTarget, setGrantTarget] = useState<AdminUser | null>(null)
  const [grantReason, setGrantReason] = useState('')
  const [grantExpiryDays, setGrantExpiryDays] = useState('')
    const [reasonTarget, setReasonTarget] = useState<{ user: AdminUser; action: ReasonAction } | null>(null)
    const [actionReason, setActionReason] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')

  async function loadData(query = search) {
    setLoading(true)
    setError('')
    try {
      const [summaryData, userData, auditData] = await Promise.all([
        api.get<AdminSummary>('/admin/summary'),
        api.get<UserPage>(`/admin/users?q=${encodeURIComponent(query)}&limit=100&offset=0`),
        api.get<AuditEntry[]>('/admin/audit?limit=30&offset=0'),
      ])
      setSummary(summaryData)
      setUsers(userData.items)
      setAudit(auditData)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadData('') }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(search) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusyId('invite')
    setError('')
    try {
      const result = await api.post<Invitation>('/admin/users/invitations', { email: inviteEmail, display_name: inviteName })
      setInvitation(result)
      setNotice('Invitation created. Copy its one-time link before closing this dialog.')
      await loadData()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusyId('')
    }
  }

  async function updateStatus(user: AdminUser) {
    setActionReason('')
    setReasonTarget({ user, action: user.is_active ? 'suspend' : 'reactivate' })
  }

  async function revokeSessions(user: AdminUser) {
    setActionReason('')
    setReasonTarget({ user, action: 'revoke_sessions' })
  }

  async function revokeGrant(user: AdminUser) {
    setActionReason('')
    setReasonTarget({ user, action: 'revoke_grant' })
  }

  async function confirmReasonAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reasonTarget || !actionReason.trim()) return
    const { user, action } = reasonTarget
    setBusyId(user.id)
    setError('')
    try {
      if (action === 'suspend' || action === 'reactivate') {
        await api.patch<AdminUser>(`/admin/users/${user.id}/status`, { is_active: action === 'reactivate', reason: actionReason.trim() })
        setNotice(`${user.email} ${action === 'reactivate' ? 'reactivated' : 'suspended'}`)
      } else if (action === 'revoke_sessions') {
        const result = await api.post<{ revoked_sessions: number }>(`/admin/users/${user.id}/sessions/revoke`, { reason: actionReason.trim() })
        setNotice(`Revoked ${result.revoked_sessions} refresh session(s) for ${user.email}. Existing access tokens expire within 15 minutes.`)
      } else if (user.active_pro_grant) {
        await api.delete<AdminUser>(`/admin/users/${user.id}/pro-grants/${user.active_pro_grant.id}?reason=${encodeURIComponent(actionReason.trim())}`)
        setNotice(`Manual Pro grant revoked for ${user.email}`)
      }
      setReasonTarget(null)
      await loadData()
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusyId('')
    }
  }

  async function createProGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!grantTarget) return
    setBusyId(grantTarget.id)
    setError('')
    try {
      const expiresAt = grantExpiryDays ? new Date(Date.now() + Number(grantExpiryDays) * 86400000).toISOString() : null
      await api.post<AdminUser>(`/admin/users/${grantTarget.id}/pro-grants`, { reason: grantReason, expires_at: expiresAt })
      setNotice(`Pro access granted to ${grantTarget.email}`)
      setGrantTarget(null)
      setGrantReason('')
      setGrantExpiryDays('')
      await loadData()
    } catch (error) {
      setError(errorText(error))
    } finally {
      setBusyId('')
    }
  }

  const inviteUrl = invitation ? `${window.location.origin}/?invite=${encodeURIComponent(invitation.invite_token)}` : ''

  return <div className="admin-page">
    <div className="admin-page-head">
      <div><div className="eyebrow"><span className="eyebrow-line" /> PLATFORM OPERATIONS</div><h1>Admin console</h1><p className="welcome-subtitle">Manage accounts and entitlements. Every change is recorded.</p></div>
      <button className="button button-primary" onClick={() => { setInvitation(null); setInviteOpen(true) }}><UserPlus size={16} /> Invite a user</button>
    </div>
    {error && <div className="admin-alert error" role="alert"><ShieldAlert size={16} />{error}</div>}
    {notice && <div className="admin-alert success" role="status"><Check size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">Ã—</button></div>}

    <div className="admin-stats">
      <AdminStat icon={<Users size={17} />} label="Total accounts" value={summary?.users ?? 'â€”'} />
      <AdminStat icon={<Check size={17} />} label="Active accounts" value={summary?.active_users ?? 'â€”'} />
      <AdminStat icon={<Crown size={17} />} label="Pro accounts" value={summary?.pro_users ?? 'â€”'} />
      <AdminStat icon={<Clock3 size={17} />} label="Pending invites" value={summary?.pending_invitations ?? 'â€”'} />
    </div>

    <section className="panel admin-users-panel">
      <div className="admin-tabs"><button className={tab === 'users' ? 'selected' : ''} onClick={() => setTab('users')}>Users</button><button className={tab === 'audit' ? 'selected' : ''} onClick={() => setTab('audit')}>Audit log</button></div>
      {tab === 'users' ? <>
        <div className="admin-toolbar"><div><h2>Accounts</h2><p>{summary?.users ?? 0} accounts Â· admin-only actions</p></div><label className="admin-search"><Search size={16} /><input aria-label="Search accounts" placeholder="Search name or email" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
        {loading ? <div className="admin-loading">Loading accountsâ€¦</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>USER</th><th>STATUS</th><th>PLAN</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}>
          <td><div className="admin-user-cell"><span className="admin-user-avatar">{user.display_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><strong>{user.display_name}</strong><small>{user.email}</small></span></div></td>
          <td><span className={`admin-status ${user.is_active ? 'active' : 'suspended'}`}><i />{user.is_active ? 'Active' : 'Suspended'}</span></td>
          <td><span className={`admin-plan ${user.is_pro ? 'pro' : ''}`}>{user.is_pro ? <><Crown size={13} /> Pro</> : 'Free'}</span>{user.active_pro_grant && <small className="grant-expiry">{user.active_pro_grant.expires_at ? `Until ${shortDate(user.active_pro_grant.expires_at)}` : 'Manual grant'}</small>}</td>
          <td className="admin-date">{shortDate(user.created_at)}</td>
          <td><div className="admin-row-actions"><button className="admin-action" disabled={busyId === user.id || user.is_pro} onClick={() => { setGrantTarget(user); setGrantReason(''); setGrantExpiryDays('') }}><Crown size={14} /> Grant Pro</button>{user.active_pro_grant && <button className="admin-action danger" disabled={busyId === user.id} onClick={() => void revokeGrant(user)}><Crown size={14} /> Revoke</button>}<button className="admin-action" disabled={busyId === user.id} onClick={() => void revokeSessions(user)}><Shield size={14} /> Sign out all</button><button className={`admin-action ${user.is_active ? 'danger' : ''}`} disabled={busyId === user.id} onClick={() => void updateStatus(user)}>{user.is_active ? <ArrowDown size={14} /> : <ArrowUp size={14} />}{user.is_active ? 'Suspend' : 'Reactivate'}</button></div></td>

          {reasonTarget && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setReasonTarget(null) }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="reason-title"><div className="admin-modal-head"><div><div className="panel-kicker">AUDITED ACCOUNT ACTION</div><h2 id="reason-title">{reasonTarget.action === 'suspend' ? 'Suspend account' : reasonTarget.action === 'reactivate' ? 'Reactivate account' : reasonTarget.action === 'revoke_sessions' ? 'Sign out all sessions' : 'Revoke Pro access'}</h2><p>{reasonTarget.user.display_name} · {reasonTarget.user.email}</p></div><button className="icon-button" onClick={() => setReasonTarget(null)} aria-label="Close action">×</button></div><form className="admin-invite-form" onSubmit={(event) => void confirmReasonAction(event)}><label>REASON<textarea required minLength={3} maxLength={240} rows={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label><p className="invitation-expiry">This action and reason will be added to the platform audit log.</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setReasonTarget(null)}>Cancel</button><button className="button button-primary" disabled={busyId === reasonTarget.user.id}>{busyId === reasonTarget.user.id ? 'Applying…' : 'Confirm action'}</button></div></form></section></div>}
        </tr>)}</tbody></table>{users.length === 0 && <div className="admin-empty">No matching users.</div>}</div>}
      </> : <>
        <div className="admin-toolbar"><div><h2>Admin activity</h2><p>Recent account and entitlement changes.</p></div><button className="button button-quiet small-button" onClick={() => void loadData()}>Refresh</button></div>
        <div className="audit-list">{audit.map((entry) => <article className="audit-row" key={entry.id}><span className="audit-mark"><Shield size={15} /></span><div><strong>{entry.action.replaceAll('.', ' ')}</strong><p>{entry.actor_email}{entry.details.email ? ` Â· ${String(entry.details.email)}` : ''}{entry.details.reason ? ` Â· ${String(entry.details.reason)}` : ''}</p></div><time>{shortDate(entry.created_at)}</time></article>)}{audit.length === 0 && <div className="admin-empty">No admin actions recorded yet.</div>}</div>
      </>}
    </section>

    {inviteOpen && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setInviteOpen(false) }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="invite-title"><div className="admin-modal-head"><div><div className="panel-kicker">ACCOUNT ACCESS</div><h2 id="invite-title">Invite a user</h2><p>Generate a single-use setup token. Share it securely.</p></div><button className="icon-button" onClick={() => setInviteOpen(false)} aria-label="Close invitation">Ã—</button></div>{invitation ? <div className="invitation-result"><div className="admin-alert success"><Check size={16} />Invite created. This token is only shown here.</div><label>INVITATION LINK<div className="copy-field"><input readOnly value={inviteUrl} /><button className="icon-button" onClick={() => void navigator.clipboard.writeText(inviteUrl)} aria-label="Copy invitation link"><Copy size={15} /></button></div></label><label>ONE-TIME TOKEN<div className="copy-field"><input readOnly value={invitation.invite_token} /><button className="icon-button" onClick={() => void navigator.clipboard.writeText(invitation.invite_token)} aria-label="Copy invitation token"><Copy size={15} /></button></div></label><p className="invitation-expiry">Expires {shortDate(invitation.expires_at)}. User sets their own password; password is never visible to admins.</p><div className="modal-actions"><button className="button button-primary" onClick={() => { setInviteOpen(false); setInvitation(null) }}>Done</button></div></div> : <form className="admin-invite-form" onSubmit={(event) => void createInvitation(event)}><label>DISPLAY NAME<input required maxLength={120} value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></label><label>EMAIL ADDRESS<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label><p className="invitation-expiry">The token expires in 7 days and can be accepted once.</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setInviteOpen(false)}>Cancel</button><button className="button button-primary" disabled={busyId === 'invite'}>{busyId === 'invite' ? 'Creatingâ€¦' : 'Create invitation'}</button></div></form>}</section></div>}

    {grantTarget && <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setGrantTarget(null) }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="admin-modal-head"><div><div className="panel-kicker">MANUAL ENTITLEMENT</div><h2 id="grant-title">Grant Pro access</h2><p>{grantTarget.display_name} Â· {grantTarget.email}</p></div><button className="icon-button" onClick={() => setGrantTarget(null)} aria-label="Close Pro grant">Ã—</button></div><form className="admin-invite-form" onSubmit={(event) => void createProGrant(event)}><label>REASON<input required minLength={3} maxLength={240} placeholder="e.g. Customer support accommodation" value={grantReason} onChange={(event) => setGrantReason(event.target.value)} /></label><label>GRANT DURATION<select value={grantExpiryDays} onChange={(event) => setGrantExpiryDays(event.target.value)}><option value="">No expiry</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label><p className="invitation-expiry">This manual grant is audited. It does not represent a paid subscription and can be revoked.</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setGrantTarget(null)}>Cancel</button><button className="button button-primary" disabled={busyId === grantTarget.id}>{busyId === grantTarget.id ? 'Grantingâ€¦' : 'Grant Pro'}</button></div></form></section></div>}
  </div>
}

function AdminStat({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return <div className="admin-stat"><span className="admin-stat-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>
}
