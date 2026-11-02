import { useState } from 'react';
import { requestConnectionCheck } from '../messaging/client';
import type { ConnectionReply } from '../messaging/contracts';
import { SessionControls } from './components/SessionControls';
import { ScopeMessageError } from '../messaging/request';

const unavailableMessages: Record<
  Extract<ConnectionReply, { status: 'unavailable' }>['reason'],
  string
> = {
  'no-active-tab': 'No active tab found. Open a webpage and try again.',
  'page-unavailable':
    'Page unavailable. On a regular webpage, click the Scope toolbar icon to grant access, then try again. Chrome internal pages and the Web Store cannot be inspected.',
  'handshake-failed':
    'Scope reached the page, but its content script did not reply correctly. Refresh the webpage and try again. If this continues, inspect Scope’s service worker console.',
  'scope-error':
    'Scope could not check the active tab. Inspect Scope’s service worker console for details.',
};

export function App() {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('Page connection has not been checked.');

  async function checkConnection() {
    setChecking(true);
    setStatus('Checking the current tab…');
    try {
      const reply = await requestConnectionCheck();
      setStatus(
        reply.status === 'connected'
          ? 'Connected to the current page.'
          : unavailableMessages[reply.reason],
      );
    } catch (error) {
      console.error('[Scope] Connection check failed.', error);
      setStatus(
        error instanceof ScopeMessageError
          ? error.message
          : 'Scope could not check the connection. Load the extension and try reopening the panel.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-5 sm:p-7">
      <header className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div>
          <p className="text-xl font-semibold tracking-tight">Scope</p>
          <p className="text-sm text-slate-400">Browser debugging companion</p>
        </div>
        <span className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300">
          Incidents
        </span>
      </header>
      <section aria-labelledby="connection-heading" className="space-y-4">
        <h1 id="connection-heading" className="text-lg font-semibold">
          Connect to your page
        </h1>
        <p className="text-sm leading-6 text-slate-300">
          Open a webpage, click the Scope toolbar icon, then check that Scope
          can communicate with the current tab.
        </p>
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkConnection()}
          className="rounded-md bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-200 disabled:cursor-wait disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Check connection'}
        </button>
        <p
          role="status"
          aria-label="Connection status"
          aria-live="polite"
          className="rounded-md border border-slate-700 bg-slate-900 p-4 text-sm leading-6 text-slate-300"
        >
          {status}
        </p>
      </section>
      <SessionControls />
      <footer className="mt-auto pt-8 text-xs leading-5 text-slate-500">
        Headers, bodies, error messages/stacks, form values, and page text are
        omitted. URL details are redacted.
      </footer>
    </main>
  );
}
