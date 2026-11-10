import type { Metadata } from 'next';

import { requestCode, verifyCode } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const MESSAGES: Record<string, string> = {
  'not-staff': 'This account does not have moderator access.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const { step, error } = await searchParams;
  const message = error ? (MESSAGES[error] ?? error) : null;
  return (
    <section className="login">
      <h1>Moderator sign-in</h1>
      <p className="muted">Use the phone number on your staff account. A code is sent to it.</p>
      {message && (
        <p role="alert" className="alert">
          {message}
        </p>
      )}
      {step === 'code' ? (
        <form action={verifyCode} className="stack">
          <label>
            6-digit code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          </label>
          <button type="submit" className="btn btn--primary">
            Sign in
          </button>
        </form>
      ) : (
        <form action={requestCode} className="stack">
          <label>
            Phone number
            <input name="phone" type="tel" autoComplete="tel" placeholder="0803 000 0000" required />
          </label>
          <button type="submit" className="btn btn--primary">
            Send code
          </button>
        </form>
      )}
    </section>
  );
}
