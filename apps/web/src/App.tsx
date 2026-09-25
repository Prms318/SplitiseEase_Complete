import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight,
  Bell, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CreditCard,
  Filter, Globe2, Home, LayoutGrid, Menu, Moon, MoreHorizontal,
  Plus, Search, Settings, ShieldCheck, Sun, Users, Wallet, X,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

type Page = 'Overview' | 'Groups' | 'Activity' | 'Reports' | 'Settings'
type Group = { id: number; name: string; category: string; members: number; balance: number; updated: string; tint: string; initials: string }
type ActivityItem = { id: number; title: string; group: string; person: string; amount: number; time: string; icon: 'expense' | 'settled' | 'added'; color: string }
type Modal = 'expense' | 'group' | 'settle' | null

const initialGroups: Group[] = [
  { id: 1, name: 'Copenhagen weekend', category: 'TRIP', members: 6, balance: 248.6, updated: '12 min ago', tint: 'sage', initials: 'CW' },
  { id: 2, name: 'Apartment 4B', category: 'HOME', members: 3, balance: -86.25, updated: '1 hr ago', tint: 'peach', initials: 'A4' },
  { id: 3, name: 'Sunday supper club', category: 'FOOD', members: 8, balance: 42.75, updated: 'Yesterday', tint: 'lilac', initials: 'SC' },
  { id: 4, name: 'Maya & me', category: 'PERSONAL', members: 2, balance: -24, updated: 'Mon, Sep 21', tint: 'sky', initials: 'MM' },
]

const initialActivity: ActivityItem[] = [
  { id: 1, title: 'Canal boat tickets', group: 'Copenhagen weekend', person: 'Maya Chen', amount: 174, time: '12 min ago', icon: 'expense', color: 'sage' },
  { id: 2, title: 'September utilities', group: 'Apartment 4B', person: 'You', amount: 92.5, time: '1 hr ago', icon: 'expense', color: 'peach' },
  { id: 3, title: 'Settled with Maya', group: 'Maya & me', person: 'You', amount: 38, time: 'Yesterday', icon: 'settled', color: 'blue' },
  { id: 4, title: 'Dinner at Bar Moro', group: 'Sunday supper club', person: 'Leo Park', amount: 286.4, time: 'Yesterday', icon: 'expense', color: 'lilac' },
]

const chartData = [
  { month: 'Apr', owed: 218, owe: 144 }, { month: 'May', owed: 284, owe: 172 },
  { month: 'Jun', owed: 238, owe: 193 }, { month: 'Jul', owed: 346, owe: 181 },
  { month: 'Aug', owed: 301, owe: 224 }, { month: 'Sep', owed: 392, owe: 216 },
]

const breakdown = [
  { name: 'Trips', value: 48, color: '#91a875' },
  { name: 'Home', value: 27, color: '#e69d79' },
  { name: 'Food', value: 18, color: '#b3a2ca' },
  { name: 'Other', value: 7, color: '#8facc0' },
]

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(value))
const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

function App() {
  const [page, setPage] = useState<Page>('Overview')
  const [groups, setGroups] = useState(initialGroups)
  const [activity, setActivity] = useState(initialActivity)
  const [modal, setModal] = useState<Modal>(null)
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('splitease-theme') as 'light' | 'dark') || 'light')
  const [settleGroup, setSettleGroup] = useState<Group | null>(null)
  const [toast, setToast] = useState('')

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

  const startSettle = (group: Group) => {
    setSettleGroup(group)
    setModal('settle')
  }

  const completeSettle = () => {
    if (!settleGroup) return
    setGroups((current) => current.map((group) => group.id === settleGroup.id ? { ...group, balance: 0, updated: 'Just now' } : group))
    setActivity((current) => [{
      id: Date.now(), title: `Settled ${settleGroup.balance < 0 ? 'with Alex' : 'by Jordan'}`,
      group: settleGroup.name, person: 'You', amount: Math.abs(settleGroup.balance), time: 'Just now', icon: 'settled', color: 'blue',
    }, ...current])
    setModal(null)
    setToast('Settlement recorded in this preview')
  }

  const addExpense = (payload: { title: string; groupName: string; amount: number }) => {
    setActivity((current) => [{
      id: Date.now(), title: payload.title, group: payload.groupName, person: 'You', amount: payload.amount,
      time: 'Just now', icon: 'expense', color: 'sage',
    }, ...current])
    setGroups((current) => current.map((group) => group.name === payload.groupName ? { ...group, updated: 'Just now' } : group))
    setModal(null)
    setToast('Expense added to this preview')
  }

  const addGroup = (name: string, category: string) => {
    setGroups((current) => [{
      id: Date.now(), name, category: category.toUpperCase(), members: 1, balance: 0, updated: 'Just now', tint: category === 'Home' ? 'peach' : 'sage', initials: name.slice(0, 2).toUpperCase(),
    }, ...current])
    setModal(null)
    setToast(`${name} is ready for your first expense`)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setPage('Overview')} aria-label="SplitEase home">
          <span className="brand-mark"><ArrowLeftRight size={19} strokeWidth={2.8} /></span>
          <span>split<span className="brand-light">ease</span><i>.</i></span>
        </a>

        <div className="workspace-switcher">
          <div className="workspace-avatar">J</div>
          <div className="workspace-copy"><strong>Jordan's space</strong><span>Personal workspace</span></div>
          <ChevronDown size={15} />
        </div>

        <p className="nav-label">WORKSPACE</p>
        <nav className="main-nav" aria-label="Main navigation">
          <NavItem icon={<Home />} label="Overview" active={page === 'Overview'} onClick={() => setPage('Overview')} />
          <NavItem icon={<Users />} label="Groups" active={page === 'Groups'} onClick={() => setPage('Groups')} count={groups.length} />
          <NavItem icon={<Activity />} label="Activity" active={page === 'Activity'} onClick={() => setPage('Activity')} />
          <NavItem icon={<LayoutGrid />} label="Reports" active={page === 'Reports'} onClick={() => setPage('Reports')} />
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
            <div className="avatar avatar-you">JD</div>
            <div className="profile-copy"><strong>Jordan Davis</strong><span>Free plan</span></div>
            <button className="icon-button mini" title="Profile options" onClick={() => setPage('Settings')}><MoreHorizontal size={18} /></button>
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
            <div className="avatar avatar-you top-avatar">JD</div>
          </div>
        </header>

        <div className="page-wrap">
          {page === 'Overview' && <Overview groups={filteredGroups} activity={activity} totalBalance={totalBalance} onAdd={() => setModal('expense')} onNewGroup={() => setModal('group')} onSettle={startSettle} onPage={setPage} />}
          {page === 'Groups' && <GroupsPage groups={filteredGroups} query={query} setQuery={setQuery} onAdd={() => setModal('group')} onSettle={startSettle} />}
          {page === 'Activity' && <ActivityPage activity={activity} />}
          {page === 'Reports' && <ReportsPage totalBalance={totalBalance} />}
          {page === 'Settings' && <SettingsPage theme={theme} setTheme={setTheme} onToast={setToast} />}
        </div>
      </main>

      <div className="preview-ribbon"><span className="pulse-dot" /> LOCAL PREVIEW <span className="ribbon-divider">·</span> API NOT CONNECTED</div>
      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
      {modal && <ModalShell onClose={() => setModal(null)}>
        {modal === 'expense' && <ExpenseModal groups={groups} onClose={() => setModal(null)} onSave={addExpense} />}
        {modal === 'group' && <GroupModal onClose={() => setModal(null)} onSave={addGroup} />}
        {modal === 'settle' && settleGroup && <SettleModal group={settleGroup} onClose={() => setModal(null)} onConfirm={completeSettle} />}
      </ModalShell>}
    </div>
  )
}

function NavItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} aria-label={label} title={label} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <small>{count}</small>}</button>
}

function Overview({ groups, activity, totalBalance, onAdd, onNewGroup, onSettle, onPage }: {
  groups: Group[]; activity: ActivityItem[]; totalBalance: number; onAdd: () => void; onNewGroup: () => void; onSettle: (group: Group) => void; onPage: (page: Page) => void
}) {
  const owed = groups.reduce((sum, group) => sum + Math.max(0, group.balance), 0)
  const owing = groups.reduce((sum, group) => sum + Math.max(0, -group.balance), 0)
  return <>
    <div className="welcome-row">
      <div><div className="eyebrow"><span className="eyebrow-line" /> FRIDAY, SEPTEMBER 25, 2026</div><h1>Good afternoon, Jordan<span className="wave">.</span></h1><p className="welcome-subtitle">Here's the shape of things across your circles.</p></div>
      <div className="header-buttons"><button className="button button-quiet" onClick={onNewGroup}><Plus size={16} /> New group</button><button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add an expense</button></div>
    </div>

    <section className="balance-grid" aria-label="Balance summary">
      <div className="balance-card balance-total"><div className="balance-card-top"><span className="balance-label">YOUR NET BALANCE</span><span className="status-pill"><span className="status-dot" />ALL GROUPS</span></div><div className={`balance-amount ${totalBalance >= 0 ? 'positive-text' : 'negative-text'}`}>{totalBalance >= 0 ? '+' : '-'}{money(totalBalance)}</div><div className="balance-card-foot"><span>Across {groups.length} active groups</span><span className="balance-trend"><ArrowUpRight size={14} /> 12.8%</span></div><div className="total-watermark"><ArrowLeftRight size={76} strokeWidth={1} /></div></div>
      <div className="balance-card balance-owed"><div className="balance-card-top"><span className="balance-label">YOU ARE OWED</span><span className="balance-icon owed-icon"><ArrowDownLeft size={17} /></span></div><div className="balance-amount">{money(owed)}</div><div className="balance-card-foot"><span>From 4 people</span><button onClick={() => onPage('Groups')}>View details <ArrowRight size={13} /></button></div><div className="mini-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>
      <div className="balance-card balance-owing"><div className="balance-card-top"><span className="balance-label">YOU OWE</span><span className="balance-icon owing-icon"><ArrowUpRight size={17} /></span></div><div className="balance-amount">{money(owing)}</div><div className="balance-card-foot"><span>Across 3 groups</span><button onClick={() => onPage('Groups')}>Settle up <ArrowRight size={13} /></button></div><div className="owing-decoration"><span /><span /><span /></div></div>
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
          <PersonBalance name="Maya Chen" handle="Copenhagen weekend" initials="MC" amount={86.5} tint="sage" onClick={() => onSettle({ ...groups[0], balance: 86.5 })} />
          <PersonBalance name="Alex Rivera" handle="Apartment 4B" initials="AR" amount={-48.25} tint="peach" onClick={() => onSettle({ ...groups[1], balance: -48.25 })} />
          <PersonBalance name="Leo Park" handle="Sunday supper club" initials="LP" amount={162.1} tint="lilac" onClick={() => onSettle({ ...groups[2], balance: 162.1 })} />
          <button className="settle-all" onClick={() => onSettle(groups.find((group) => group.balance !== 0) || groups[0])}><ArrowLeftRight size={15} />Review all balances</button>
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

function ReportsPage({ totalBalance }: { totalBalance: number }) {
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

function ExpenseModal({ groups, onClose, onSave }: { groups: Group[]; onClose: () => void; onSave: (payload: { title: string; groupName: string; amount: number }) => void }) {
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [groupName, setGroupName] = useState(groups[0]?.name || '')
  const [method, setMethod] = useState('Equal split')
  const [error, setError] = useState('')
  const parsedAmount = Number(amount)
  const next = () => {
    if (step === 1 && (!title.trim() || !parsedAmount || parsedAmount <= 0)) { setError('Add a description and a valid amount to continue.'); return }
    setError('')
    if (step < 3) setStep(step + 1)
    else onSave({ title: title.trim(), groupName, amount: parsedAmount })
  }
  return <><div className="modal-top"><div><div className="modal-eyebrow">NEW EXPENSE · {String(step).padStart(2, '0')} / 03</div><h2>{step === 1 ? 'What did you spend?' : step === 2 ? 'Who was it for?' : 'How should it split?'}</h2><p>{step === 1 ? 'A few details and you’re all square.' : step === 2 ? 'Choose the circle this belongs to.' : 'Everyone gets a fair share by default.'}</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="step-track"><span className={step >= 1 ? 'done' : ''} /><span className={step >= 2 ? 'done' : ''} /><span className={step >= 3 ? 'done' : ''} /></div>
    {step === 1 && <div className="modal-fields"><label>DESCRIPTION<input autoFocus placeholder="e.g. Dinner at Bar Moro" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>AMOUNT<div className="money-input"><span>$</span><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))} /></div></label><label>PAID BY<div className="select-wrap"><select defaultValue="You"><option>You</option><option>Maya Chen</option><option>Alex Rivera</option><option>Leo Park</option></select><ChevronDown size={15} /></div></label></div>}
    {step === 2 && <div className="modal-fields"><label>GROUP<div className="select-wrap"><select value={groupName} onChange={(event) => setGroupName(event.target.value)}>{groups.map((group) => <option key={group.id}>{group.name}</option>)}</select><ChevronDown size={15} /></div></label><div className="member-select-label">SPLIT WITH</div><div className="member-check-list">{[['JD', 'You', true], ['MC', 'Maya Chen', true], ['AR', 'Alex Rivera', true], ['LP', 'Leo Park', true]].map(([initials, name, checked]) => <div className="member-check" key={String(name)}><div className={`avatar ${initials === 'JD' ? 'avatar-you' : 'person-avatar sage'}`}>{initials}</div><span>{name}</span><span className="check-mark">{checked && <Check size={14} />}</span></div>)}</div></div>}
    {step === 3 && <div className="modal-fields"><div className="split-options">{['Equal split', 'Exact amounts', 'By percentage'].map((name, index) => <button key={name} className={`split-option ${method === name ? 'chosen' : ''}`} onClick={() => setMethod(name)}><span className="split-radio">{method === name && <i />}</span><span><strong>{name}</strong><small>{index === 0 ? 'Split evenly between 4 people' : index === 1 ? 'Enter each person’s share' : 'Choose a percentage for each'}</small></span></button>)}</div><div className="split-preview"><span><Users size={15} /> 4 people sharing</span><strong>{money(parsedAmount / 4)} <small>each</small></strong></div><div className="demo-note"><ShieldCheck size={15} /> Changes here are saved only in this local preview.</div></div>}
    {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-quiet" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button><button className="button button-primary" onClick={next}>{step === 3 ? 'Add expense' : 'Continue'} <ArrowRight size={15} /></button></div></>
}

function GroupModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string, category: string) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('Trip')
  const [error, setError] = useState('')
  return <><div className="modal-top"><div><div className="modal-eyebrow">MAKE A LITTLE SPACE</div><h2>Start a group</h2><p>For the people you share things with.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="modal-fields"><label>GROUP NAME<input autoFocus placeholder="e.g. Summer house" value={name} onChange={(event) => setName(event.target.value)} /></label><label>WHAT'S IT FOR?<div className="select-wrap"><select value={category} onChange={(event) => setCategory(event.target.value)}><option>Trip</option><option>Home</option><option>Food & drink</option><option>Couple</option><option>Other</option></select><ChevronDown size={15} /></div></label><div className="group-preview"><div className={`group-avatar ${category === 'Home' ? 'peach' : 'sage'}`}>{name.slice(0, 2).toUpperCase() || 'SE'}</div><div><strong>{name || 'Your new group'}</strong><span>{category} · USD · Just you for now</span></div></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={() => name.trim() ? onSave(name.trim(), category) : setError('Give your group a name first.')}>Create group <ArrowRight size={15} /></button></div></>
}

function SettleModal({ group, onClose, onConfirm }: { group: Group; onClose: () => void; onConfirm: () => void }) {
  const amount = Math.abs(group.balance)
  return <><div className="modal-top"><div><div className="modal-eyebrow">CLEAR THE AIR (AND THE BALANCE)</div><h2>Settle up</h2><p>Confirm the amount and how you’d like to close it out.</p></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="settle-summary"><div className="settle-group-icon"><ArrowLeftRight size={19} /></div><div><span>{group.name}</span><strong>{group.balance < 0 ? 'You owe Alex Rivera' : 'Jordan owes you'}</strong></div><b className={group.balance < 0 ? 'negative-text' : 'positive-text'}>{group.balance < 0 ? '-' : '+'}{money(amount)}</b></div><div className="payment-methods"><span className="member-select-label">PAYMENT METHOD</span><div className="payment-method selected"><div className="payment-brand stripe-brand">S</div><span><strong>Stripe test flow</strong><small>Mock payment · no charge</small></span><span className="radio-dot active" /></div><div className="payment-method"><div className="payment-brand wallet-brand"><Wallet size={16} /></div><span><strong>Record a cash payment</strong><small>Mark as settled in this preview</small></span><span className="radio-dot" /></div><div className="payment-badges"><span className="stripe-badge">stripe</span><span className="apple-badge">Pay</span><span className="gpay-badge"><b>G</b> Pay</span><small>Payment badges shown for design preview</small></div></div><div className="demo-note"><ShieldCheck size={15} /> No real payment is processed. API and payment provider are not connected.</div><div className="modal-actions"><button className="button button-quiet" onClick={onClose}>Not now</button><button className="button button-primary" onClick={onConfirm}>Record settlement <Check size={15} /></button></div></>
}

function SparkleMark() { return <span className="sparkle-mark">✳</span> }

export default App