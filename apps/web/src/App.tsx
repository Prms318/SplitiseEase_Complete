import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight,
  Bell, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CreditCard,
  Filter, Globe2, Home, LayoutGrid, LogOut, Menu, Moon, MoreHorizontal,
  Plus, Search, Settings, ShieldCheck, Sun, Users, X,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import AuthScreen from './AuthScreen'
import AdminPage from './AdminPage'
import { api, getSession, setSession, type ApiBalance, type ApiExpense, type ApiGroup, type ApiGroupMember, type ApiSession, type ApiSettlement, type ApiSplit, type ApiUser } from './api'

type Page = 'Overview' | 'Groups' | 'Activity' | 'Reports' | 'Settings' | 'Admin'
type Group = { id: string | number; name: string; category: string; members: number; balance: number; updated: string; tint: string; initials: string; kind?: 'group' | 'friend'; currency?: string; memberDetails?: ApiGroupMember[]; balanceRows?: ApiBalance[] }
type ActivityItem = { id: string | number; title: string; group: string; person: string; amount: number; time: string; icon: 'expense' | 'settled' | 'added'; color: string; currency?: string }
type Modal = 'expense' | 'group' | 'settle' | null
type ChartPoint = { month: string; owed: number; owe: number }
type BreakdownItem = { name: string; value: number; color: string }

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(value))
const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
const groupColors = ['#91a875', '#e69d79', '#b3a2ca', '#8facc0', '#d0ad6f', '#81aaa0']

function makeInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SE'
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

async function loadWorkspaceData(user: ApiUser): Promise<{ groups: Group[]; activity: ActivityItem[]; chartData: ChartPoint[]; breakdown: BreakdownItem[] }> {
  const summaries = await api.get<ApiGroup[]>('/api/v1/groups')
  const snapshots = await Promise.all(summaries.map(async (summary, index) => {
    const [memberDetails, balanceResponse, expenses] = await Promise.all([
      api.get<ApiGroupMember[]>(`/api/v1/groups/${summary.id}/members`),
      api.get<{ balances: ApiBalance[] }>(`/api/v1/groups/${summary.id}/balances`),
      api.get<ApiExpense[]>(`/api/v1/groups/${summary.id}/expenses?limit=100`),
    ])
    const friend = memberDetails.find((member) => member.user_id !== user.id)
    const name = summary.kind === 'friend' && friend ? `${friend.display_name} & you` : summary.name
    const ownNet = balanceResponse.balances.find((balance) => balance.user_id === user.id)?.net_minor ?? 0
    const mostRecent = expenses[0]?.created_at ?? summary.created_at
    return {
      group: {
        id: summary.id,
        name,
        category: summary.kind === 'friend' ? 'FRIEND' : 'GROUP',
        members: summary.member_count,
        balance: ownNet / 100,
        updated: relativeTime(mostRecent),
        tint: summary.kind === 'friend' ? 'sky' : ['sage', 'peach', 'lilac', 'sky'][index % 4],
        initials: makeInitials(name),
        kind: summary.kind,
        currency: summary.currency,
        memberDetails,
        balanceRows: balanceResponse.balances,
      } satisfies Group,
      expenses,
    }
  }))

  const activity = snapshots.flatMap(({ group, expenses }) => expenses.map((expense) => ({
    id: expense.id,
    title: expense.description,
    group: group.name,
    person: group.memberDetails?.find((member) => member.user_id === expense.paid_by_user_id)?.display_name
      ? (expense.paid_by_user_id === user.id ? 'You' : group.memberDetails.find((member) => member.user_id === expense.paid_by_user_id)!.display_name)
      : 'A group member',
    amount: expense.amount_minor / 100,
    currency: expense.currency,
    time: relativeTime(expense.created_at),
    icon: 'expense' as const,
    color: group.tint,
  }))).sort((left, right) => {
    const leftExpense = snapshots.flatMap((snapshot) => snapshot.expenses).find((expense) => expense.id === left.id)
    const rightExpense = snapshots.flatMap((snapshot) => snapshot.expenses).find((expense) => expense.id === right.id)
    return new Date(rightExpense?.created_at ?? 0).getTime() - new Date(leftExpense?.created_at ?? 0).getTime()
  })

  const currentDate = new Date()
  const chartData: ChartPoint[] = []
  const chartIndex = new Map<string, ChartPoint>()
  for (let offset = 5; offset >= 0; offset--) {
    const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - offset, 1)
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`
    const point = { month: monthDate.toLocaleDateString('en-US', { month: 'short' }), owed: 0, owe: 0 }
    chartData.push(point)
    chartIndex.set(key, point)
  }
  const spendingByGroup = new Map<string, { total: number; color: string }>()
  for (const { group, expenses } of snapshots) {
    for (const expense of expenses) {
      if (expense.currency !== 'USD') continue
      const amount = expense.amount_minor / 100
      const monthKey = expense.occurred_at.slice(0, 7)
      const point = chartIndex.get(monthKey)
      if (point) {
        const ownShareMinor = expense.splits.find((split) => split.user_id === user.id)?.owed_minor ?? 0
        if (expense.paid_by_user_id === user.id) point.owed += (expense.amount_minor - ownShareMinor) / 100
        else point.owe += ownShareMinor / 100
      }
      const bucket = spendingByGroup.get(group.name) ?? { total: 0, color: groupColors[spendingByGroup.size % groupColors.length] }
      bucket.total += amount
      spendingByGroup.set(group.name, bucket)
    }
  }
  const totalSpend = [...spendingByGroup.values()].reduce((total, bucket) => total + bucket.total, 0)
  const breakdown = totalSpend > 0
    ? [...spendingByGroup.entries()].map(([name, bucket]) => ({ name, value: Math.round((bucket.total / totalSpend) * 100), color: bucket.color }))
    : []

  return { groups: snapshots.map(({ group }) => group), activity, chartData, breakdown }
}

function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [session, setSessionState] = useState<ApiSession | null>(() => getSession())
  const [user, setUser] = useState<ApiUser | null>(() => getSession()?.user ?? null)
  const [authReady, setAuthReady] = useState(true)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [groups, setGroups] = useState<Group[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('splitease-theme') as 'light' | 'dark') || 'light')
  const [settleGroup, setSettleGroup] = useState<Group | null>(null)
  const [settleCounterpartyId, setSettleCounterpartyId] = useState<string | undefined>()
  const [toast, setToast] = useState('')
  const [monthlyData, setMonthlyData] = useState<ChartPoint[]>([])
  const [spendingBreakdown, setSpendingBreakdown] = useState<BreakdownItem[]>([])

  async function refreshWorkspace(activeUser: ApiUser) {
    setWorkspaceLoading(true)
    try {
      const snapshot = await loadWorkspaceData(activeUser)
      setGroups(snapshot.groups)
      setActivity(snapshot.activity)
      setMonthlyData(snapshot.chartData)
      setSpendingBreakdown(snapshot.breakdown)
    } finally {
      setWorkspaceLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setAuthReady(true)
      return () => { cancelled = true }
    }
    setWorkspaceLoading(true)
    void (async () => {
      try {
        const activeUser = await api.currentUser()
        if (cancelled) return
        setUser(activeUser)
        const snapshot = await loadWorkspaceData(activeUser)
        if (cancelled) return
        setGroups(snapshot.groups)
        setActivity(snapshot.activity)
        setMonthlyData(snapshot.chartData)
        setSpendingBreakdown(snapshot.breakdown)
      } catch {
        if (!cancelled) {
          setSession(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) {
          setAuthReady(true)
          setWorkspaceLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('splitease-theme', theme)
  }, [theme])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  const totalBalance = useMemo(() => groups.reduce((sum, group) => sum + group.balance, 0), [groups])
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(query.toLowerCase()))

  const acceptSession = async (nextSession: ApiSession) => {
    setSession(nextSession)
    setSessionState(nextSession)
    setUser(nextSession.user)
    setAuthReady(true)
    try {
      await refreshWorkspace(nextSession.user)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not load your workspace')
    }
  }

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      setSession(null)
      setSessionState(null)
      setUser(null)
      setGroups([])
      setActivity([])
      setPage('Overview')
    }
  }

  const startSettle = (group: Group, counterpartyId?: string) => {
    setSettleGroup(group)
    setSettleCounterpartyId(counterpartyId)
    setModal('settle')
  }

  const completeSettle = async (payerId: string, payeeId: string, amountMinor: number) => {
    if (!settleGroup || !user || amountMinor <= 0) return
    try {
      await api.post<ApiSettlement>(`/api/v1/groups/${settleGroup.id}/settlements`, {
        idempotency_key: crypto.randomUUID(),
        payer_user_id: payerId,
        payee_user_id: payeeId,
        amount_minor: amountMinor,
        currency: settleGroup.currency || 'USD',
      })
      setModal(null)
      setToast('Settlement recorded')
      await refreshWorkspace(user)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not record settlement')
    }
  }

  const addExpense = async (payload: { title: string; groupId: string; amountMinor: number; splitMethod: 'equal' | 'exact'; paidByUserId: string; splits: ApiSplit[] }) => {
    if (!user) return
    const group = groups.find((item) => item.id === payload.groupId)
    if (!group) return
    try {
      await api.post<ApiExpense>(`/api/v1/groups/${group.id}/expenses`, {
        client_mutation_id: crypto.randomUUID(),
        description: payload.title,
        amount_minor: payload.amountMinor,
        currency: group.currency || 'USD',
        split_method: payload.splitMethod,
        paid_by_user_id: payload.paidByUserId,
        occurred_at: new Date().toISOString(),
        splits: payload.splits,
      })
      setModal(null)
      setToast('Expense added')
      await refreshWorkspace(user)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not add expense')
    }
  }

  const addGroup = async (name: string) => {
    await api.post<ApiGroup>('/api/v1/groups', { name, currency: 'USD', member_ids: [] })
    setModal(null)
    setToast(`${name} created`)
    if (user) await refreshWorkspace(user)
  }

  if (!authReady) return <div className="auth-loading">Connecting to SplitEase...</div>
  if (!session || !user) return <AuthScreen onAuthenticated={acceptSession} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setPage('Overview')} aria-label="SplitEase home">
          <span className="brand-mark"><ArrowLeftRight size={19} strokeWidth={2.8} /></span>
          <span>split<span className="brand-light">ease</span><i>.</i></span>
        </a>

        <div className="workspace-switcher">
          <div className="workspace-avatar">J</div>
          <div className="workspace-copy"><strong>{user.display_name}'s space</strong><span>{user.email}</span></div>
          <ChevronDown size={15} />
        </div>

        <p className="nav-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          <NavItem icon={<Home />} label="Overview" active={page === 'Overview'} onClick={() => setPage('Overview')} />
          <NavItem icon={<Users />} label="Groups" active={page === 'Groups'} onClick={() => setPage('Groups')} count={groups.length} />
          <NavItem icon={<Activity />} label="Activity" active={page === 'Activity'} onClick={() => setPage('Activity')} />
          <NavItem icon={<LayoutGrid />} label="Reports" active={page === 'Reports'} onClick={() => setPage('Reports')} />
          {user.is_platform_admin && <NavItem icon={<ShieldCheck />} label="Admin" active={page === 'Admin'} onClick={() => setPage('Admin')} />}
        </nav>

        <div className="sidebar-group-title"><span className="nav-label">YOUR GROUPS</span><button className="icon-button mini" title="Create group" onClick={() => setModal('group')}><Plus size={16} /></button></div>
        <div className="sidebar-groups">
          {groups.slice(0, 4).map((group) => <button className="sidebar-group" key={group.id} onClick={() => { setPage('Groups'); setQuery(group.name) }}><span className={`tiny-group-icon ${group.tint}`}>{group.initials.slice(0, 1)}</span><span>{group.name}</span></button>)}
        </div>

        <div className="sidebar-bottom">
          <button className="pro-promo" onClick={() => { setPage('Settings'); setToast('Pro plan details are shown in Settings') }}>
            <span className="promo-icon"><SparkleMark /></span>
            <span><strong>Make room for more</strong><small>Explore SplitEase Pro</small></span>
            <ArrowRight size={15} />
          </button>
          <NavItem icon={<Settings />} label="Settings" active={page === 'Settings'} onClick={() => setPage('Settings')} />
          <button className="help-link" onClick={() => setToast('Help center is coming soon')}><CircleHelp size={17} /> Help & support</button>
          <div className="profile-row">
            <div className="avatar avatar-you">{makeInitials(user.display_name)}</div>
            <div className="profile-copy"><strong>{user.display_name}</strong><span>{user.is_pro ? 'Pro plan' : 'Free plan'}</span></div>
            <button className="icon-button mini" title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {navOpen && <div className="mobile-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNavOpen(false) }}>
        <aside className="mobile-drawer" aria-label="Mobile navigation">
          <div className="drawer-head"><a className="brand" href="#overview" onClick={() => { setPage('Overview'); setNavOpen(false) }}><span className="brand-mark"><ArrowLeftRight size={18} /></span><span>split<span className="brand-light">ease</span><i>.</i></span></a><button className="icon-button" onClick={() => setNavOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
          <p className="nav-label">WORKSPACE</p>
          <nav className="main-nav" aria-label="Mobile main navigation">
            <NavItem icon={<Home />} label="Overview" active={page === 'Overview'} onClick={() => { setPage('Overview'); setNavOpen(false) }} />
            <NavItem icon={<Users />} label="Groups" active={page === 'Groups'} onClick={() => { setPage('Groups'); setNavOpen(false) }} count={groups.length} />
            <NavItem icon={<Activity />} label="Activity" active={page === 'Activity'} onClick={() => { setPage('Activity'); setNavOpen(false) }} />
            <NavItem icon={<LayoutGrid />} label="Reports" active={page === 'Reports'} onClick={() => { setPage('Reports'); setNavOpen(false) }} />
            <NavItem icon={<Settings />} label="Settings" active={page === 'Settings'} onClick={() => { setPage('Settings'); setNavOpen(false) }} />
            {user.is_platform_admin && <NavItem icon={<ShieldCheck />} label="Admin" active={page === 'Admin'} onClick={() => { setPage('Admin'); setNavOpen(false) }} />}
          </nav>
          <p className="nav-label drawer-groups-label">YOUR GROUPS</p>
          {groups.map((group) => <button className="sidebar-group" key={group.id} onClick={() => { setPage('Groups'); setQuery(group.name); setNavOpen(false) }}><span className={`tiny-group-icon ${group.tint}`}>{group.initials.slice(0, 1)}</span><span>{group.name}</span></button>)}
        </aside>
      </div>}

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><button className="icon-button" onClick={() => setNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><span className="brand-mark"><ArrowLeftRight size={17} /></span><b>splitease<i>.</i></b></div>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{page}</strong></div>
          <div className="top-actions">
            <label className="search-box"><Search size={17} /><input ref={searchRef} aria-label="Search groups" placeholder="Search groups..." value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>{searchShortcut}</kbd></label>
            <button className="icon-button theme-toggle" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</button>
            <button className="icon-button notification-button" title="Notifications" aria-label="Notifications" onClick={() => setToast('You are all caught up')}><Bell size={18} /><span /></button>
            <div className="avatar avatar-you top-avatar" title={user.email}>{makeInitials(user.display_name)}</div>
          </div>
        </header>

        <div className="page-wrap">
          {page === 'Overview' && <Overview groups={filteredGroups} activity={activity} totalBalance={totalBalance} chartData={monthlyData} user={user} onAdd={() => setModal('expense')} onNewGroup={() => setModal('group')} onSettle={startSettle} onPage={setPage} />}
          {page === 'Groups' && <GroupsPage groups={filteredGroups} query={query} setQuery={setQuery} onAdd={() => setModal('group')} onSettle={startSettle} />}
          {page === 'Activity' && <ActivityPage activity={activity} />}
          {page === 'Reports' && <ReportsPage totalBalance={totalBalance} chartData={monthlyData} breakdown={spendingBreakdown} />}
          {page === 'Settings' && <SettingsPage theme={theme} setTheme={setTheme} onToast={setToast} />}
          {page === 'Admin' && user.is_platform_admin && <AdminPage />}
        </div>
      </main>

      <div className="preview-ribbon"><span className="pulse-dot" /> LIVE API <span className="ribbon-divider">·</span>{workspaceLoading ? 'SYNCING' : 'CONNECTED'}</div>
      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
      {modal && <ModalShell onClose={() => setModal(null)}>
        {modal === 'expense' && <ExpenseModal groups={groups} user={user} onClose={() => setModal(null)} onSave={addExpense} />}
        {modal === 'group' && <GroupModal onClose={() => setModal(null)} onSave={addGroup} />}
        {modal === 'settle' && settleGroup && <SettleModal group={settleGroup} user={user} initialCounterpartyId={settleCounterpartyId} onClose={() => setModal(null)} onConfirm={completeSettle} />}
      </ModalShell>}
    </div>
  )
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} aria-label={label} title={label} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>
}

function Overview({ groups, activity, totalBalance, chartData, user, onAdd, onNewGroup, onSettle, onPage }: {
  groups: Group[]; activity: ActivityItem[]; totalBalance: number; chartData: ChartPoint[]; user: ApiUser; onAdd: () => void; onNewGroup: () => void; onSettle: (group: Group, counterpartyId?: string) => void; onPage: (page: Page) => void
}) {
  const owed = groups.reduce((sum, group) => sum + Math.max(0, group.balance), 0)
  const owing = groups.reduce((sum, group) => sum + Math.max(0, -group.balance), 0)
  return <>
    <div className="welcome-row">
      <div><div className="eyebrow"><span className="eyebrow-line" /> {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</div><h1>Good afternoon, {user.display_name.split(' ')[0]}<span className="wave">.</span></h1><p className="welcome-subtitle">Here's the shape of things across your circles.</p></div>
      <div className="header-buttons"><button className="button button-quiet" onClick={onNewGroup}><Plus size={16} /> New group</button><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add an expense</button></div>
    </div>

    <section className="balance-grid" aria-label="Balance summary">
      <div className="balance-card balance-total"><div className="balance-card-top"><span className="balance-label">YOUR NET BALANCE</span><span className="status-pill"><span className="status-dot" />ALL GROUPS</span></div><div className={`balance-amount ${totalBalance >= 0 ? 'positive-text' : 'negative-text'}`}>{totalBalance >= 0 ? '+' : '-'}{money(totalBalance)}</div><div className="balance-card-foot"><span>Across {groups.length} active groups</span><span className="balance-trend"><ArrowUpRight size={14} /> 12.8%</span></div><div className="total-watermark"><ArrowLeftRight size={76} strokeWidth={1} /></div></div>
      <div className="balance-card balance-owed"><div className="balance-card-top"><span className="balance-label">YOU ARE OWED</span><span className="balance-icon owed-icon"><ArrowDownLeft size={17} /></span></div><div className="balance-amount">{money(owed)}</div><div className="balance-card-foot"><span>Across your groups</span><button onClick={() => onPage('Groups')}>View details <ArrowRight size={13} /></button></div><div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
      <div className="balance-card balance-owing"><div className="balance-card-top"><span className="balance-label">YOU OWE</span><span className="balance-icon owing-icon"><ArrowUpRight size={17} /></span></div><div className="balance-amount">{money(owing)}</div><div className="balance-card-foot"><span>Across your groups</span><button onClick={() => onPage('Groups')}>Settle up <ArrowRight size={13} /></button></div><div className="owing-decoration"><span /><span /><span /></div></div>
    </section>

    <div className="dashboard-grid">
      <div className="left-column">
        <section className="panel groups-panel">
          <div className="panel-heading"><div><div className="panel-kicker">YOUR CIRCLES</div><h2>Groups <span className="count-bubble">{groups.length}</span></h2></div><button className="text-button" onClick={() => onPage('Groups')}>All groups <ArrowRight size={14} /></button></div>
          <div className="group-table-head"><span>GROUP</span><span>MEMBERS</span><span>YOUR BALANCE</span><span>LAST ACTIVE</span><span /></div>
          {groups.slice(0, 4).map((group) => <GroupRow key={group.id} group={group} onSettle={onSettle} />)}
          <button className="add-group-row" onClick={onNewGroup}><span><Plus size={15} /></span> Start a new group <ArrowRight size={14} /></button>
        </section>

        <section className="panel activity-panel">
          <div className="panel-heading"><div><div className="panel-kicker">THE LATEST</div><h2>Recent activity</h2></div><button className="text-button" onClick={() => onPage('Activity')}>Full activity <ArrowRight size={14} /></button></div>
          <div className="activity-list">{activity.slice(0, 4).map((item) => <ActivityRow key={item.id} item={item} />)}</div>
        </section>
      </div>

      <div className="right-column">
        <section className="panel chart-panel">
          <div className="panel-heading chart-heading"><div><div className="panel-kicker">MONEY IN MOTION</div><h2>Balance over time</h2></div><button className="select-button">6 months <ChevronDown size={14} /></button></div>
          <div className="chart-legend"><span><i className="legend-owed" />Owed to you</span><span><i className="legend-owing" />You owe</span></div>
          <div className="balance-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: -20 }}>
            <defs><linearGradient id="owedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#789268" stopOpacity={0.23} /><stop offset="95%" stopColor="#789268" stopOpacity={0} /></linearGradient><linearGradient id="oweFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#df9175" stopOpacity={0.18} /><stop offset="95%" stopColor="#df9175" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 10 }} tickFormatter={(value) => `$${value}`} />
            <Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)', fontFamily: 'DM Sans' }} formatter={(value) => money(Number(value))} />
            <Area type="monotone" dataKey="owed" name="Owed to you" stroke="#789268" strokeWidth={2.4} fill="url(#owedFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="owe" name="You owe" stroke="#df9175" strokeWidth={2.2} fill="url(#oweFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart></ResponsiveContainer></div>
          <div className="chart-footer"><span><span className="chart-foot-dot" />Net position is trending up</span><span>Compared to last month <b>+8.4%</b></span></div>
        </section>

        <section className="panel people-panel">
          <div className="panel-heading"><div><div className="panel-kicker">OPEN BALANCES</div><h2>People to settle with</h2></div><button className="icon-button mini" title="Balance options"><MoreHorizontal size={18} /></button></div>
          {groups.flatMap((group) => {
            const ownNet = group.balanceRows?.find((balance) => balance.user_id === user.id)?.net_minor ?? 0
            return (group.balanceRows || [])
            .filter((balance) => balance.user_id !== user.id && balance.net_minor !== 0 && ownNet * balance.net_minor < 0)
            .map((balance) => {
              const person = group.memberDetails?.find((member) => member.user_id === balance.user_id)
              return <PersonBalance key={`${group.id}:${balance.user_id}`} name={person?.display_name || 'Group member'} handle={group.name} initials={makeInitials(person?.display_name || 'GM')} amount={-balance.net_minor / 100} tint={group.tint} onClick={() => onSettle(group, balance.user_id)} />
            })
          }).slice(0, 4)}
          {groups.every((group) => {
            const ownNet = group.balanceRows?.find((balance) => balance.user_id === user.id)?.net_minor ?? 0
            return ownNet === 0 || (group.balanceRows || []).every((balance) => balance.user_id === user.id || balance.net_minor === 0 || ownNet * balance.net_minor >= 0)
          }) && <p className="empty-balances">No open balances right now. A rare and lovely thing.</p>}
          {groups.some((group) => group.balance !== 0) && <button className="settle-all" onClick={() => onSettle(groups.find((group) => group.balance !== 0)!)}><ArrowLeftRight size={15} />Review all balances</button>}
        </section>
      </div>
    </div>

    <footer className="page-footer"><span>Everything's split, nothing's awkward.</span><span>Made for the in-between <span className="footer-sparkle">✳</span></span></footer>
  </>
}

function GroupRow({ group, onSettle }: { group: Group; onSettle: (group: Group) => void }) {
  const owed = group.balance > 0
  return <div className="group-row">
    <div className="group-name-cell"><div className={`group-avatar ${group.tint}`}>{group.initials}</div><div className="group-name-copy"><strong>{group.name}</strong><span>{group.category}</span></div></div>
    <div className="member-stack"><div className="avatar-stack"><span className="stack-avatar stack-one">M</span><span className="stack-avatar stack-two">A</span><span className="stack-avatar stack-three">L</span>{group.members > 3 && <span className="stack-more">+{group.members - 3}</span>}</div><small>{group.members} members</small></div>
    <div className={`group-balance ${group.balance === 0 ? 'zero' : owed ? 'owed' : 'owing'}`}><span>{group.balance === 0 ? 'Settled' : owed ? '+' : '-'}{group.balance !== 0 && money(group.balance)}</span><small>{group.balance === 0 ? 'all clear' : owed ? 'you are owed' : 'you owe'}</small></div>
    <div className="group-updated">{group.updated}</div>
    <button className="row-action" onClick={() => onSettle(group)} aria-label={`Settle ${group.name}`} title="Settle up"><ArrowRight size={16} /></button>
  </div>
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const icon = item.icon === 'settled' ? <Check size={16} /> : item.icon === 'added' ? <Users size={16} /> : <CreditCard size={16} />
  return <div className="activity-row"><div className={`activity-icon ${item.color}`}>{icon}</div><div className="activity-copy"><strong>{item.title}</strong><span><b>{item.person}</b> in {item.group}</span></div><div className="activity-amount"><strong>{money(item.amount)}</strong><span>{item.time}</span></div></div>
}

function PersonBalance({ name, handle, initials, amount, tint, onClick }: { name: string; handle: string; initials: string; amount: number; tint: string; onClick: () => void }) {
  const owesYou = amount > 0
  return <div className="person-balance-row"><div className={`avatar person-avatar ${tint}`}>{initials}</div><div className="person-balance-copy"><strong>{name}</strong><span>{handle}</span></div><div className={`person-amount ${owesYou ? 'positive-text' : 'negative-text'}`}><strong>{owesYou ? '+' : '-'}{money(amount)}</strong><span>{owesYou ? 'owes you' : 'you owe'}</span></div><button className="person-settle" aria-label={`Settle with ${name}`} onClick={onClick}><ArrowRight size={15} /></button></div>
}

function GroupsPage({ groups, query, setQuery, onAdd, onSettle }: { groups: Group[]; query: string; setQuery: (value: string) => void; onAdd: () => void; onSettle: (group: Group) => void }) {
  const [filter, setFilter] = useState('All groups')
  const visibleGroups = groups.filter((group) => filter === 'All groups' || (filter === 'Owed to you' ? group.balance > 0 : filter === 'You owe' ? group.balance < 0 : group.balance === 0))
  return <>
    <div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR PEOPLE, YOUR PLANS</div><h1>Groups <span className="count-bubble title-count">{groups.length}</span></h1><p className="welcome-subtitle">The little worlds you're splitting life with.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Create a group</button></div>
    <section className="panel full-groups-panel"><div className="groups-toolbar"><div className="segmented">{['All groups', 'Owed to you', 'You owe', 'Settled'].map((name) => <button className={filter === name ? 'selected' : ''} key={name} onClick={() => setFilter(name)}>{name}</button>)}</div><div className="toolbar-tools"><label className="table-search"><Search size={16} /><input placeholder="Find a group" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button filter-button" title="Filter groups" onClick={() => setFilter('All groups')}><Filter size={17} /></button></div></div>
      <div className="group-table-head expanded"><span>GROUP</span><span>MEMBERS</span><span>YOUR BALANCE</span><span>LAST ACTIVE</span><span /></div>
      {visibleGroups.length ? visibleGroups.map((group) => <GroupRow key={group.id} group={group} onSettle={onSettle} />) : <div className="empty-state"><div className="empty-icon"><Search size={19} /></div><strong>No groups found</strong><span>Try another search or create a new group.</span></div>}
    </section>
    <div className="groups-note"><ShieldCheck size={17} /><span>Your groups are private. Only invited members can see shared expenses.</span></div>
  </>
}

function ActivityPage({ activity }: { activity: ActivityItem[] }) {
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> EVERY LITTLE THING, ACCOUNTED FOR</div><h1>Activity</h1><p className="welcome-subtitle">A clear trail of the money moving between you.</p></div><button className="button button-quiet"><Filter size={16} /> Filters <ChevronDown size={14} /></button></div>
    <section className="panel activity-page-panel"><div className="activity-date-label">TODAY <span>SEPT 25</span></div>{activity.map((item) => <ActivityRow key={item.id} item={item} />)}<div className="activity-date-label older-label">EARLIER THIS WEEK</div><ActivityRow item={{ id: 99, title: 'Groceries at Green Market', group: 'Apartment 4B', person: 'You', amount: 64.32, time: 'Sep 22', icon: 'expense', color: 'sage' }} /></section>
  </>
}

function ReportsPage({ totalBalance, chartData, breakdown }: { totalBalance: number; chartData: ChartPoint[]; breakdown: BreakdownItem[] }) {
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR MONEY, IN CONTEXT</div><h1>Reports</h1><p className="welcome-subtitle">Patterns are more useful when everyone can see them.</p></div><button className="button button-quiet"><ChevronLeft size={15} /> Sep 2026 <ChevronRight size={15} /></button></div>
    <div className="reports-grid"><section className="panel report-chart-panel"><div className="panel-heading"><div><div className="panel-kicker">SHARED SPENDING</div><h2>Where it went</h2></div><button className="select-button">This year <ChevronDown size={14} /></button></div><div className="donut-wrap"><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="94%" paddingAngle={3} stroke="none">{breakdown.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie><Tooltip formatter={(value) => `${value}%`} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} /></PieChart></ResponsiveContainer><div className="donut-center"><span>NET POSITION</span><strong className={totalBalance >= 0 ? 'positive-text' : 'negative-text'}>{totalBalance >= 0 ? '+' : '-'}{money(totalBalance)}</strong></div></div><div className="breakdown-list">{breakdown.map((item) => <div className="breakdown-item" key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><strong>{item.value}%</strong></div>)}</div></div></section>
      <section className="panel report-insight"><div className="panel-kicker">A SMALL OBSERVATION</div><div className="insight-mark"><SparkleMark /></div><h2>Good things are shared.</h2><p>Trips make up nearly half of your shared spending this year. Your group of six has split <b>$2,840</b> across 14 expenses.</p><div className="insight-rule" /><div className="insight-stat"><span>Top shared category</span><strong>Travel <ArrowUpRight size={14} /></strong></div></section></div>
    <section className="panel trend-panel"><div className="panel-heading"><div><div className="panel-kicker">OVER THE LAST SIX MONTHS</div><h2>Balances, at a glance</h2></div><div className="chart-legend"><span><i className="legend-owed" />Owed to you</span><span><i className="legend-owing" />You owe</span></div></div><div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 10, right: 14, bottom: 0, left: -16 }}><defs><linearGradient id="reportOwed" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#789268" stopOpacity={0.22} /><stop offset="100%" stopColor="#789268" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 5" /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} dy={10} /><YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(value) => `$${value}`} /><Tooltip contentStyle={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' }} formatter={(value) => money(Number(value))} /><Area type="monotone" dataKey="owed" name="Owed to you" stroke="#789268" strokeWidth={2.4} fill="url(#reportOwed)" /><Area type="monotone" dataKey="owe" name="You owe" stroke="#df9175" strokeWidth={2.2} fill="transparent" /></AreaChart></ResponsiveContainer></div></section>
  </>
}

function SettingsPage({ theme, setTheme, onToast }: { theme: 'light' | 'dark'; setTheme: (value: 'light' | 'dark') => void; onToast: (value: string) => void }) {
  const [currency, setCurrency] = useState('USD — US Dollar')
  return <><div className="page-title-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR SPACE, YOUR RULES</div><h1>Settings</h1><p className="welcome-subtitle">Make SplitEase feel a little more like yours.</p></div></div>
    <div className="settings-layout"><div className="settings-nav panel"><button className="settings-tab selected"><Users size={16} /> Profile</button><button className="settings-tab" onClick={() => onToast('Group settings are managed from each group')}><Users size={16} /> Groups</button><button className="settings-tab" onClick={() => onToast('Security settings are coming soon')}><ShieldCheck size={16} /> Security</button><button className="settings-tab" onClick={() => onToast('Billing settings are coming soon')}><CreditCard size={16} /> Billing</button></div>
      <div className="settings-content"><section className="panel settings-panel"><div className="settings-panel-head"><div><h2>Personal details</h2><p>Your profile is shown to people in your groups.</p></div><button className="button button-quiet small-button" onClick={() => onToast('Profile saved in this preview')}>Save changes</button></div><div className="profile-edit"><div className="avatar edit-avatar">JD<button title="Change photo" onClick={() => onToast('Photo upload will be available when connected')}><Plus size={13} /></button></div><div><strong>Jordan Davis</strong><span>Joined April 2025 · jordan@email.com</span></div></div><div className="form-grid"><label>Display name<input defaultValue="Jordan Davis" /></label><label>Email address<input defaultValue="jordan@email.com" /></label></div></section>
      <section className="panel settings-panel"><div className="settings-panel-head"><div><h2>Preferences</h2><p>Small details that make a difference.</p></div></div><div className="preference-row"><div className="preference-icon"><Globe2 size={17} /></div><div className="preference-copy"><strong>Default currency</strong><span>Used when you create a new group.</span></div><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD — US Dollar</option><option>EUR — Euro</option><option>GBP — British Pound</option><option>CAD — Canadian Dollar</option></select></div><div className="preference-row"><div className="preference-icon">{theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}</div><div className="preference-copy"><strong>Appearance</strong><span>Choose a look for your workspace.</span></div><div className="theme-choice"><button className={theme === 'light' ? 'chosen' : ''} onClick={() => setTheme('light')}><Sun size={14} /> Light</button><button className={theme === 'dark' ? 'chosen' : ''} onClick={() => setTheme('dark')}><Moon size={14} /> Dark</button></div></div><div className="preference-row"><div className="preference-icon"><Bell size={17} /></div><div className="preference-copy"><strong>Weekly digest</strong><span>A gentle Friday recap of your groups.</span></div><Toggle initial /></div></section>
      <section className="panel settings-panel pro-settings"><div className="pro-settings-mark"><SparkleMark /></div><div className="pro-settings-copy"><div className="panel-kicker">A LITTLE MORE ROOM</div><h2>SplitEase Pro</h2><p>Multi-currency groups, receipt scanning, and a little less admin.</p></div><button className="button button-primary" onClick={() => onToast('Pro subscription checkout will be connected to billing')}>Explore Pro <ArrowRight size={15} /></button></section></div></div>
  </>
}

function Toggle({ initial = false }: { initial?: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  return <button className={`toggle ${enabled ? 'enabled' : ''}`} role="switch" aria-checked={enabled} aria-label="Toggle weekly digest" onClick={() => setEnabled(!enabled)}><span /></button>
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div className="modal" role="dialog" aria-modal="true">{children}</div></div>
}

function ExpenseModal({ groups, user, onClose, onSave }: { groups: Group[]; user: ApiUser; onClose: () => void; onSave: (payload: { title: string; groupId: string; amountMinor: number; splitMethod: 'equal' | 'exact'; paidByUserId: string; splits: ApiSplit[] }) => Promise<void> }) {
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [groupId, setGroupId] = useState(String(groups[0]?.id || ''))
  const [memberIds, setMemberIds] = useState<string[]>(groups[0]?.memberDetails?.map((member) => member.user_id) || [user.id])
  const [paidByUserId, setPaidByUserId] = useState(user.id)
  const [method, setMethod] = useState<'equal' | 'exact'>('equal')
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const parsedAmount = Number(amount)
  const amountMinor = Math.round(parsedAmount * 100)
  const selectedGroup = groups.find((group) => String(group.id) === groupId)
  const members = selectedGroup?.memberDetails || []
  const orderedMemberIds = [...memberIds].sort()
  const baseShare = orderedMemberIds.length ? Math.floor(amountMinor / orderedMemberIds.length) : 0
  const remainder = orderedMemberIds.length ? amountMinor % orderedMemberIds.length : 0
  const equalSplits = orderedMemberIds.map((id, index) => ({ user_id: id, owed_minor: baseShare + (index < remainder ? 1 : 0) }))
  const exactSplits = orderedMemberIds.map((id) => ({ user_id: id, owed_minor: Math.max(0, Math.round(Number(exactAmounts[id] || 0) * 100)) }))
  const splits = method === 'equal' ? equalSplits : exactSplits
  const splitsReconcile = splits.length > 0 && splits.reduce((sum, split) => sum + split.owed_minor, 0) === amountMinor
  const selectedMemberKey = memberIds.slice().sort().join(',')

  useEffect(() => {
    if (method !== 'exact' || !orderedMemberIds.length) return
    const base = parsedAmount > 0 ? parsedAmount / orderedMemberIds.length : 0
    setExactAmounts((current) => Object.fromEntries(orderedMemberIds.map((id) => [id, current[id] ?? base.toFixed(2)])))
  }, [method, selectedMemberKey, amount])

  const next = async () => {
    if (step === 1 && (!title.trim() || !parsedAmount || parsedAmount <= 0)) { setError('Add a description and a valid amount to continue.'); return }
    if (step === 2 && (!selectedGroup || memberIds.length === 0)) { setError('Choose a group and at least one participant.'); return }
    if (step === 3 && !splitsReconcile) { setError('Split amounts must add up to the full expense amount.'); return }
    setError('')
    if (step < 3) setStep(step + 1)
    else {
      setSaving(true)
      try {
        await onSave({ title: title.trim(), groupId, amountMinor, splitMethod: method, paidByUserId, splits })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not save expense')
      } finally {
        setSaving(false)
      }
    }
  }
  return <><div className="modal-top"><div><div className="modal-eyebrow">NEW EXPENSE · {String(step).padStart(2, '0')} / 03</div><h2>{step === 1 ? 'What did you spend?' : step === 2 ? 'Who was it for?' : 'How should it split?'}</h2><p>{step === 1 ? 'A few details and you’re all square.' : step === 2 ? 'Choose a group and the people sharing it.' : 'Check the shares before saving.'}</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="step-track"><span className={step >= 1 ? 'done' : ''} /><span className={step >= 2 ? 'done' : ''} /><span className={step >= 3 ? 'done' : ''} /></div>
    {step === 1 && <div className="modal-fields"><label>DESCRIPTION<input autoFocus placeholder="e.g. Dinner at Bar Moro" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>AMOUNT<div className="money-input"><span>{selectedGroup?.currency || 'USD'}</span><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} /></div></label><div className="demo-note"><ShieldCheck size={15} /> This expense will be saved to your signed-in SplitEase account.</div></div>}
    {step === 2 && <div className="modal-fields"><label>GROUP OR FRIEND<div className="select-wrap"><select value={groupId} onChange={(event) => { const nextGroup = groups.find((group) => String(group.id) === event.target.value); setGroupId(event.target.value); setMemberIds(nextGroup?.memberDetails?.map((member) => member.user_id) || []); setPaidByUserId(user.id) }}>{groups.map((group) => <option key={group.id} value={group.id}>{group.kind === 'friend' ? `Friend · ${group.name}` : group.name}</option>)}</select><ChevronDown size={15} /></div></label><label>PAID BY<div className="select-wrap"><select value={paidByUserId} onChange={(event) => setPaidByUserId(event.target.value)}>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</option>)}</select><ChevronDown size={15} /></div></label><div className="member-select-label">SPLIT WITH</div><div className="member-check-list">{members.map((member) => <button type="button" className="member-check" key={member.user_id} onClick={() => setMemberIds((current) => current.includes(member.user_id) ? current.filter((id) => id !== member.user_id) : [...current, member.user_id])}><div className={`avatar ${member.user_id === user.id ? 'avatar-you' : 'person-avatar sage'}`}>{makeInitials(member.display_name)}</div><span>{member.display_name}{member.user_id === user.id ? ' (you)' : ''}</span><span className={`check-mark ${memberIds.includes(member.user_id) ? '' : 'unchecked'}`}>{memberIds.includes(member.user_id) && <Check size={14} />}</span></button>)}</div></div>}
    {step === 3 && <div className="modal-fields"><div className="split-options">{([{ value: 'equal', label: 'Equal split', detail: 'Distribute any extra cents fairly' }, { value: 'exact', label: 'Exact amounts', detail: 'Enter each person’s share' }] as const).map((option) => <button type="button" key={option.value} className={`split-option ${method === option.value ? 'chosen' : ''}`} onClick={() => setMethod(option.value)}><span className="split-radio">{method === option.value && <i />}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</div>{method === 'exact' && orderedMemberIds.map((id) => <label className="exact-share" key={id}>{members.find((member) => member.user_id === id)?.display_name || 'Member'}<div className="money-input"><span>{selectedGroup?.currency || 'USD'}</span><input inputMode="decimal" value={exactAmounts[id] ?? ''} onChange={(event) => setExactAmounts((current) => ({ ...current, [id]: event.target.value.replace(/[^0-9.]/g, '') }))} /></div></label>)}<div className="split-preview"><span><Users size={15} /> {memberIds.length} people · total {money(amountMinor / 100)}</span><strong>{splitsReconcile ? 'Balanced' : `${money(Math.abs(amountMinor - splits.reduce((sum, split) => sum + split.owed_minor, 0)) / 100)} left`} <small>{method === 'equal' ? 'each' : ''}</small></strong></div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-quiet" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button><button className="button button-primary" disabled={saving || groups.length === 0} onClick={() => void next()}>{saving ? 'Saving...' : step === 3 ? 'Add expense' : 'Continue'} <ArrowRight size={15} /></button></div></>
}

function GroupModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    if (!name.trim()) { setError('Give your group a name first.'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create group')
    } finally {
      setSaving(false)
    }
  }
  return <><div className="modal-top"><div><div className="modal-eyebrow">MAKE A LITTLE SPACE</div><h2>Start a group</h2><p>Invite members and share expenses in one place.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="modal-fields"><label>GROUP NAME<input autoFocus placeholder="e.g. Summer house" value={name} onChange={(event) => setName(event.target.value)} /></label><div className="group-preview"><div className="group-avatar sage">{makeInitials(name || 'SE')}</div><div><strong>{name || 'Your new group'}</strong><span>USD · You can add members next</span></div></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void submit()}>{saving ? 'Creating...' : 'Create group'} <ArrowRight size={15} /></button></div></>
}

function SettleModal({ group, user, initialCounterpartyId, onClose, onConfirm }: { group: Group; user: ApiUser; initialCounterpartyId?: string; onClose: () => void; onConfirm: (payerId: string, payeeId: string, amountMinor: number) => Promise<void> }) {
  const ownNet = group.balanceRows?.find((balance) => balance.user_id === user.id)?.net_minor || 0
  const otherBalances = (group.balanceRows || []).filter((balance) => balance.user_id !== user.id && (ownNet < 0 ? balance.net_minor > 0 : balance.net_minor < 0))
  const defaultCounterparty = otherBalances[0]
  const [counterpartyId, setCounterpartyId] = useState(initialCounterpartyId || defaultCounterparty?.user_id || '')
  const [amount, setAmount] = useState(String(Math.abs(ownNet) / 100))
  const [saving, setSaving] = useState(false)
  const counterparty = otherBalances.find((balance) => balance.user_id === counterpartyId)
  const amountMinor = Math.round(Number(amount) * 100)
  const maxMinor = Math.min(Math.abs(ownNet), Math.abs(counterparty?.net_minor || 0))
  const validAmount = amountMinor > 0 && amountMinor <= maxMinor
  const confirm = async () => {
    if (!counterparty || !validAmount) return
    setSaving(true)
    await onConfirm(ownNet < 0 ? user.id : counterparty.user_id, ownNet < 0 ? counterparty.user_id : user.id, amountMinor)
    setSaving(false)
  }
  return <><div className="modal-top"><div><div className="modal-eyebrow">CLEAR THE AIR (AND THE BALANCE)</div><h2>Settle up</h2><p>Record a manual payment in the group ledger.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="settle-summary"><div className="settle-group-icon"><ArrowLeftRight size={19} /></div><div><span>{group.name}</span><strong>{ownNet < 0 ? 'You owe' : 'You are owed'}</strong></div><b className={ownNet < 0 ? 'negative-text' : 'positive-text'}>{ownNet < 0 ? '-' : '+'}{money(ownNet / 100)}</b></div><div className="modal-fields"><label>SETTLE WITH<div className="select-wrap"><select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)}>{otherBalances.map((balance) => <option key={balance.user_id} value={balance.user_id}>{group.memberDetails?.find((member) => member.user_id === balance.user_id)?.display_name || 'Group member'} · {money(balance.net_minor / 100)} {balance.net_minor > 0 ? 'owed' : 'owes'}</option>)}</select><ChevronDown size={15} /></div></label><label>AMOUNT<div className="money-input"><span>{group.currency || 'USD'}</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} /></div><small>Up to {money(maxMinor / 100)} for this balance.</small></label>{!otherBalances.length && <p className="form-error">No opposite balance is available to settle in this group.</p>}</div><div className="demo-note"><ShieldCheck size={15} /> This records a manual settlement. No card payment is processed.</div><div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Not now</button><button className="button button-primary" disabled={saving || !validAmount} onClick={() => void confirm()}>{saving ? 'Recording...' : 'Record settlement'} <Check size={15} /></button></div></>
}

function SparkleMark() { return <span className="sparkle-mark">✳</span> }

export default App