import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, takeRecovery } from '../lib/auth';
import { getClient } from '../lib/data';
import { Mark } from '../components/Brand';
import { Stamp } from '../components/Stamp';

export function SignIn() {
  const { user, ready } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  if (ready && user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      await getClient().auth.signIn(email.trim(), password);
      nav('/', { replace: true });
    } catch {
      setError('Wrong email or password.');
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    setError(''); setInfo('');
    if (!email.trim()) { setError('Type your email first.'); return; }
    try {
      await getClient().auth.resetPassword(email.trim());
      setInfo('Check your email for a reset link.');
    } catch {
      setError('Could not send the reset mail.');
    }
  };
  return (
    <main className="signin">
      <div className="sheetpaper">
      <header className="si-head">
        <div>
          <div className="brand"><Mark size={28} /></div>
          <h1>WorkOS</h1>
          <p className="si-sub">Sign in to open today's sheet.</p>
        </div>
        <Stamp name="Your day" />
      </header>
      <form onSubmit={submit}>
        <div className="field"><label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label></div>
        <div className="field"><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label></div>
        {error && <p className="err" role="alert">{error}</p>}
        {info && <p className="hint" role="status">{info}</p>}
        <div className="si-acts">
          <button type="submit" className="btn primary" disabled={busy}>Sign in</button>
          <button type="button" className="btn ghost" onClick={() => void forgot()}>Forgot password</button>
        </div>
      </form>
      </div>
    </main>
  );
}

export function Reset() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [ok, setOk] = useState(false);
  const [who, setWho] = useState('');
  useEffect(() => {
    const t = takeRecovery();
    if (!t) { setOk(true); void getClient().auth.getUser().then((u) => setWho(u?.email ?? '')); return; }
    void getClient().auth.acceptRecovery(t).then(() => { setOk(true); void getClient().auth.getUser().then((u) => setWho(u?.email ?? '')); }).catch(() => { setError('This link has expired.'); setOk(true); });
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await getClient().auth.updatePassword(pw);
      setDone(true);
      setTimeout(() => nav('/', { replace: true }), 800);
    } catch {
      setError('Could not change the password. Try a longer one.');
    }
  };
  return (
    <main className="signin">
      <div className="sheetpaper">
      <header className="si-head">
        <div>
          <div className="brand"><Mark size={28} /></div>
          <h1>New password</h1>
          <p className="si-sub">Twelve characters or more.</p>
        </div>
      </header>
      {!ok ? <p className="hint">Checking the link.</p> : (
        <form onSubmit={submit}>
          {who && <p className="hint" data-testid="reset-for">For {who}</p>}
          <div className="field"><label>New password<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={12} /></label></div>
          {error && <p className="err" role="alert">{error}</p>}
          {done && <p className="hint" role="status">Password changed.</p>}
          <div className="si-acts"><button type="submit" className="btn primary">Save password</button></div>
        </form>
      )}
      </div>
    </main>
  );
}
