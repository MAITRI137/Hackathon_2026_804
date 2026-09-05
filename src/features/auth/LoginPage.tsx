/**
 * Sign-in.
 *
 * This is real authentication, not a doorway: the form posts to the API, which
 * verifies an Argon2id hash, regenerates the session, sets an HttpOnly cookie
 * and returns the caller's permission set. A wrong password and an unknown
 * address produce the same message and take the same time, so the form cannot
 * be used to discover who has an account.
 *
 * The demo personas are listed openly because this is a hackathon build with a
 * public seed — they fill the form, they do not bypass it.
 */
import { useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { ROLE_LABEL, type Role } from '@shared/types';
import { DEMO_PASSWORD, ROLE_EMAIL, signIn, type BootstrapPayload } from '@/lib/api';
import { Button } from '@/ui/primitives';
import { TextInput } from '@/ui/form';
import { BrandMark } from '@/ui/BrandMark';

const PERSONAS: { role: Role; name: string; blurb: string }[] = [
  { role: 'HR_PAYROLL_MANAGER', name: 'Maitri Shah', blurb: 'Runs payroll end to end' },
  { role: 'HR_MANAGER', name: 'Priya Desai', blurb: 'People operations, no payroll' },
  { role: 'HR_PAYROLL_USER', name: 'Isha Mehta', blurb: 'Prepares payroll, cannot validate' },
  { role: 'EMPLOYEE', name: 'Aarav Patel', blurb: 'Own data only' },
  { role: 'ADMIN', name: 'System Administrator', blurb: 'Users, settings, operations' },
];

export function LoginPage({ onSignedIn }: { onSignedIn: (payload: BootstrapPayload) => void }) {
  const [email, setEmail] = useState(ROLE_EMAIL.HR_PAYROLL_MANAGER);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onSignedIn(await signIn(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.');
      setPending(false);
    }
  };

  return (
    <div className="login">
      <section className="login-pitch">
        <div className="login-brand">
          <BrandMark size={40} />
          <div>
            <strong>PeoplePay360</strong>
            <span>HR &amp; Payroll Operating System</span>
          </div>
        </div>

        <h1>Correct payroll, with the work taken out of it.</h1>
        <p>
          Every rupee traces from the source record to the payslip line that produced it, and
          invalid payroll is blocked before money moves.
        </p>

        <ul className="login-points">
          <li>
            <ShieldCheck size={16} aria-hidden />
            <span>
              <b>Exception-first payroll.</b> A run cannot be validated while a blocking exception
              is open, and each one is fixed by correcting the record behind it.
            </span>
          </li>
          <li>
            <ShieldCheck size={16} aria-hidden />
            <span>
              <b>Explainable to the paise.</b> Every payslip line keeps its rule, formula, inputs
              and source records.
            </span>
          </li>
          <li>
            <ShieldCheck size={16} aria-hidden />
            <span>
              <b>Authorisation on the server.</b> Five roles, one permission matrix; hiding a menu
              is never the control.
            </span>
          </li>
        </ul>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={submit} noValidate>
          <header>
            <span className="eyebrow">Sign in</span>
            <h2>Welcome back</h2>
            <p className="muted">Use a work address and password to continue.</p>
          </header>

          {error && (
            <p className="field-err" role="alert">
              <AlertCircle size={14} aria-hidden />
              {error}
            </p>
          )}

          <TextInput
            label="Work email"
            type="email"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button type="submit" variant="primary" block icon={ArrowRight} pending={pending}>
            Sign in
          </Button>

          <p className="login-note">
            <Lock size={12} aria-hidden />
            Argon2id password hashing, HttpOnly server session, origin-checked writes.
          </p>
        </form>

        <div className="login-personas">
          <span className="eyebrow">Demo personas — seeded accounts, same password</span>
          <div className="persona-grid">
            {PERSONAS.map((p) => (
              <button
                key={p.role}
                type="button"
                className="persona"
                onClick={() => {
                  setEmail(ROLE_EMAIL[p.role]);
                  setPassword(DEMO_PASSWORD);
                  setError(null);
                }}
              >
                <b>{ROLE_LABEL[p.role]}</b>
                <span>{p.name}</span>
                <em>{p.blurb}</em>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Selecting a persona fills the form. You still sign in, and the server still decides what
            that role may see.
          </p>
        </div>
      </section>
    </div>
  );
}
