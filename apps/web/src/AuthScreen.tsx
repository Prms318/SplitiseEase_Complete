import { useState, type FormEvent } from 'react'
import { ArrowLeftRight, ArrowRight, ShieldCheck, UserRoundPlus } from 'lucide-react'
import { api, type ApiSession } from './api'
import './AuthScreen.css'

type AuthScreenProps = {
  onAuthenticated: (session: ApiSession) => Promise<void>
}

export default function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('demo@splitease.example.com')
  const [password, setPassword] = useState('LocalDemoPass!2026')
  const [displayName, setDisplayName] = useState('Jordan Davis')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = mode === 'login'
        ? await api.login(email, password)
        : await api.register(email, password, displayName)
      await onAuthenticated(session)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign in')
    } finally {
      setBusy(false)
    }
  }

  return <div className="auth-shell">
    <aside className="auth-aside">
      <a className="brand auth-brand" href="#signin"><span className="brand-mark"><ArrowLeftRight size={19} strokeWidth={2.8} /></span><span>split<span className="brand-light">ease</span><i>.</i></span></a>
      <div className="auth-aside-copy"><span className="eyebrow"><span className="eyebrow-line" /> SHARED LIFE, CLEARER MATH</span><h1>Good things<br />are shared.</h1><p>Your circles, expenses and balances in one place.</p></div>
      <div className="auth-aside-foot"><ShieldCheck size={16} /><span>Private by group. Clear by design.</span></div>
      <div className="auth-lines" aria-hidden="true"><span /><span /><span /></div>
    </aside>
    <main className="auth-main">
      <div className="auth-form-wrap">
        <div className="auth-mobile-brand"><span className="brand-mark"><ArrowLeftRight size={18} /></span><strong>splitease<i>.</i></strong></div>
        <div className="auth-kicker">YOUR SPACE, ALL SQUARED</div>
        <h2>{mode === 'login' ? 'Welcome back.' : 'Make it official.'}</h2>
        <p className="auth-intro">{mode === 'login' ? 'Sign in to see what your circles are up to.' : 'Create an account to start sharing expenses.'}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' && <label>YOUR NAME<input autoComplete="name" required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
          <label>EMAIL ADDRESS<input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>PASSWORD<input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" minLength={12} maxLength={72} required value={password} onChange={(event) => setPassword(event.target.value)} /><small>Use at least 12 characters.</small></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create account'}{!busy && <ArrowRight size={16} />}</button>
        </form>
        <div className="auth-switch"><span>{mode === 'login' ? 'New to SplitEase?' : 'Already have an account?'}</span><button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}>{mode === 'login' ? 'Create account' : 'Sign in'} <UserRoundPlus size={14} /></button></div>
        <div className="auth-demo-note"><span className="pulse-dot" /><span>Local demo account is prefilled. Run <code>services/tests/seed-demo.ps1</code> once to load sample groups and expenses.</span></div>
      </div>
    </main>
  </div>
}