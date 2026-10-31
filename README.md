# Scope

Scope is a Chrome debugging companion that records what happens while
a developer reproduces a bug and turns related browser events into a
readable debugging timeline.

## Core Workflow

Record → Capture → Normalize → Sanitize → Correlate → Detect → Report

## Main Features

- Debugging sessions
- User interaction capture
- Network monitoring
- Runtime error capture
- Navigation tracking
- Unified event timeline
- Event correlation
- Automatic issue detection
- Debug report generation
- Local-first storage
- Sensitive data redaction

## Stack

- TypeScript
- React
- Vite
- Tailwind CSS
- Chrome Manifest V3
- Zustand
- Zod
- IndexedDB / Dexie
- Vitest
- React Testing Library
- Playwright

## Status

The extension foundation and session lifecycle are implemented: a React Side
Panel, validated page connection checks, persistent start/stop operations, a
session timer, and recovery after worker suspension. Event capture, correlation,
and detection are not implemented yet.

## Development

Use Node.js 24 LTS and npm.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173/sidepanel.html` for UI development. The Vite server
is a development tool; Scope has no application backend. Chrome APIs are only
available when the production build is loaded as an extension.

```bash
npm run check
```

This runs TypeScript, ESLint, formatting checks, Vitest, and a production build.
Individual commands: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run format:check`, and `npm run build`. Use `npm run format` to format files.

For the built-extension browser smoke test:

```bash
npx playwright install chromium
npm run test:e2e
```

The smoke test loads the real extension, checks worker startup, renders the panel
at a narrow width, and verifies that a missing page grant produces an unavailable
response. It then triggers the toolbar action through Chromium's debugging
protocol and verifies two successful connection checks on a test webpage,
without adding host permissions. It also verifies session start/stop, restoration
after panel reload and forced worker termination, and interruption on tab closure.
Use the manual steps below to check the actual
toolbar and Side Panel in your installed Chrome. CI runs both the standard
checks and this browser smoke test.

Dependency audit at foundation setup: `npm audit --omit=dev` reports no runtime
vulnerabilities. The full audit reports 12 moderate findings in development lint
tooling, traced to the transitive `minimatch` advisory
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Review compatible upstream fixes before changing that dependency across major
versions; these packages are not bundled into the extension.

## Load and verify in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select this project's `dist` folder.
3. Pin Scope in the extensions menu, open a regular HTTPS webpage, and click
   Scope's toolbar icon to open its Side Panel and grant temporary page access.
4. Press **Check connection**. Expect a connected message with no recording.
5. Repeat the check; it should still succeed without duplicate listeners.
6. Switch to another origin. Click the toolbar icon again to grant access to
   that tab before checking. Scope does not request permanent website access.
7. Try a Chrome internal page such as `chrome://extensions`. Expect a helpful
   unavailable message rather than a successful connection.
8. After rebuilding, reload Scope in `chrome://extensions` and refresh the test
   webpage to discard content scripts from the previous extension instance.

Chrome 116 or newer is required. This version does not collect page content,
form values, console output, or network traffic. It stores up to 100 session
metadata records locally in IndexedDB: IDs, tab IDs, status, timestamps, and end
reason. The oldest records are removed as new sessions exceed this limit.

## Verify session lifecycle

1. Rebuild and reload Scope, refresh a normal webpage, and invoke the toolbar
   action on that page to grant access.
2. Press **Start session**. Expect **Session active**, the target tab ID, and an
   increasing duration. A session contains metadata only; no events are captured.
3. Close and reopen the panel. The same active session and elapsed time should
   reappear. Only one active session is allowed across all tabs/windows.
4. In `chrome://extensions`, inspect Scope's service worker, open its Application
   panel, select Service Workers, and stop the worker. Reopen Scope and press
   **Refresh session** if necessary. Expect the active session to be restored.
   A worker restart is different from reloading the extension.
5. Press **Stop session**. Expect **Session stopped** and a frozen duration.
6. Start another session on the webpage, then close that tab. Expect **Session
   interrupted**, with **Tab closed** as its reason. If the panel closes with the
   tab, reopen Scope in another tab to inspect the persisted result.
7. Restart Chrome with an active session. On startup, any session still marked
   active becomes interrupted with **Browser restarted** as its reason. If Chrome
   delivered a tab-close event during shutdown, it may already show **Tab closed**.
   Browser-restart interruptions show no measured duration because the exact end
   of the previous browser process is unknown.

Starting rechecks page access, so switching to another origin may require another
toolbar click. Switching tabs does not move an existing session. Sessions can span
navigations in the same tab, but this version does not collect navigation events
or automatically regain revoked page access. Session history and deletion UI are
future work; metadata retention is currently automatic and bounded.

## Foundation design

See [ARCHITECTURE.md](./ARCHITECTURE.md) for execution contexts, permissions,
build decisions, and the connection-check flow. [ROADMAP.md](./ROADMAP.md)
tracks the remaining product work.
