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

Scope now has an end-to-end incident checkpoint: persistent recording sessions,
interaction/Fetch/XHR/runtime capture, deterministic problem detection and event
relationships, an incident view, and sanitized Markdown copy/download. The full
timeline, navigation-aware capture, history/deletion UI, and broader detectors
remain planned. Real-project usefulness still needs validation beyond the fixtures.

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
It types test secrets into real form fields and checks that event storage omits
them, verifies capture survives worker termination, and checks that Stop and
navigation end capture.
The network browser test runs under strict page CSP, checks native Fetch/XHR
success/error/abort behavior, inspects stored records for test secrets, and checks
that Stop restores the page APIs without aborting its in-flight requests.
The incident browser test reproduces a failed form action followed by an unhandled
TypeError, checks relationship evidence, copies/downloads the report, preserves
native error handlers, and scans stored/exported records for test secrets.
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

Chrome 116 or newer is required. This version omits form values, page text,
selectors, raw URLs, headers, bodies, console output, error messages, stacks, and
rejection values. It stores up to 100 sessions
locally in IndexedDB, each with at most 1,000 interaction events. Events contain
timing, IDs, sequence numbers, browser context IDs, and fixed element categories.
Old sessions and their events are removed together as retention exceeds 100.

## Verify session lifecycle

1. Rebuild and reload Scope, refresh a normal webpage, and invoke the toolbar
   action on that page to grant access.
2. Press **Start session**. Expect **Session active**, the target tab ID, and an
   increasing duration. Interactions in the selected tab now appear in the preview.
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
toolbar click. Switching tabs does not move an existing session. Full-page
navigation or reload interrupts the session. Hash links and same-document history
changes keep recording. Start again after invoking Scope on the new page. Session history and deletion UI remain future work.

## Verify interaction capture

1. Run `npm run dev` and open
   `http://localhost:5173/examples/interaction-playground.html` in Chrome.
   This page is a development fixture, not an extension backend.
2. Rebuild/reload Scope after changes, refresh the fixture, click Scope's toolbar
   icon, and start a session.
3. Click **Test click**, enter notes and a password, then move focus away from
   each field. Expect **Click · button**, **Input changed · input (text)**, and
   **Input changed · input (password)**. Typed values must never appear.
4. Toggle **Enabled** and submit the form. Expect checkbox-change metadata and
   **Form submitted · form**. The fixture's submission message should still update;
   Scope must not prevent submission or change the site's behavior.
5. Press **Stop session**, then keep interacting. The captured count must stop
   increasing. Reopen the panel to verify the saved events remain.
6. Start again, then reload or use the navigation link. Expect **Session
   interrupted**, with **Page navigated or reloaded** as its reason.

Text fields use the browser's `change` event, usually emitted when focus leaves a
modified field, rather than recording every keystroke. Passwords, checkboxes,
selects, and file fields record only their category; values, selected options,
checked state, filenames, field names, labels, and selectors are omitted.

Only the top frame and native controls or button/link roles are observed. Iframes,
closed shadow roots, contenteditable editors, and script-dispatched events are
outside this slice. Open shadow-root events are inspected through their composed
path when they reach the document. Programmatic submissions may be browser-trusted;
`isTrusted` is a noise filter, not proof of a human action.

Events are buffered for up to 200 ms and sent in batches of at most 20. Stop
detaches listeners and waits for delivery before saving its end time. Abrupt page
teardown can lose the final buffered interactions; this version does not claim
lossless capture across navigation. Capture failures, a full pending buffer, and
the 1,000-event limit end recording explicitly instead of growing without bounds.

## Verify network capture

1. Reload the built extension, refresh the playground, invoke Scope's toolbar
   action on it, and start a session.
2. Press **Fetch JSON**, then **XHR JSON**. The page should still receive and
   consume its responses. Scope should show a request and completion for each,
   sharing the same short request reference, with method/status/duration.
3. Press **Fetch missing file**. Expect an HTTP error response rather than a
   rejected Fetch promise. Press **Abort Fetch** to see an aborted completion.
4. Confirm `scope-test-secret` never appears in events. Unknown route segments
   appear as `[REDACTED]`, including the playground's example filenames.
5. Stop and press the buttons again. The page should still work, and the saved
   event count should remain unchanged.

Endpoint metadata is a route hint, not a full URL. It stores only same-origin /
cross-origin / unknown classification and up to eight path segments from a fixed
allowlist in `src/core/privacy/network.ts`. All other segments become `[REDACTED]`.
Credentials, hostnames, query strings, fragments, headers, request/response bodies,
error messages, and filenames are omitted. Do not add arbitrary route words to
the allowlist without reviewing their privacy implications.

Fetch duration ends when its response promise settles (typically response headers),
while XHR duration ends at its terminal load/error/abort/timeout event. These are
different timing boundaries. HTTP 4xx/5xx remain responses at capture time; the
analysis layer separately identifies them as problem candidates.
Opaque Fetch responses may have status 0, which means the status is unavailable.
Requests still in flight at Stop retain their start event without a completion;
Scope does not cancel them or invent a result.

Capture covers top-frame calls through the current page's Fetch and XHR APIs.
It does not capture worker/iframe traffic, resource loads, WebSockets, earlier
cached API references, or redirect chains. XHR opened before recording can report
completion with method `OTHER` and endpoint `unknown`. Accessor-based method
options also use `OTHER` to avoid invoking a page getter twice. Network calls are
captured regardless of whether a human or script initiated them.

Both request and completion count toward the existing 1,000-event session cap.
The page script allows at most 200 in-flight observations. Capacity/delivery
failure interrupts capture and restores its API wrappers; it never cancels the
website's traffic. Full navigation still ends the session.

## Verify the incident checkpoint

1. Rebuild/reload Scope, run `npm run dev`, and refresh
   `http://localhost:5173/examples/interaction-playground.html`.
2. Invoke Scope's toolbar action and start a fresh session. Press **Reproduce
   failed action** once. The page sends a POST to a missing test resource, then
   deliberately produces an unhandled TypeError. Browser console errors are
   expected from this fixture.
3. Press **Analyze session** in the panel. Expect one HTTP-failure incident with
   a submission, request, response, and TypeError rejection. The static dev server
   normally returns 404 for this fixture; the browser test uses a controlled 500.
4. Inspect **Relationship evidence**. Request pairing is exact by ID/context;
   action and runtime relationships are timing hypotheses. A click plus submission
   may produce a multiple-actions caveat, even for this simple flow.
5. Use **Preview sanitized report**, **Copy report**, and **Download Markdown**.
   The report should contain the ordered evidence and limitations, with none of
   the fixture's `scope-private-*` strings. Clipboard failure has a download fallback.
6. Press **Throw uncaught exception**, then analyze again. Expect a separate
   runtime incident; a new intervening action prevents attaching it to the earlier
   request. Error category and sanitized source position are retained, but raw
   messages, stacks, and arbitrary rejection values are omitted.
7. Stop the session, repeat the error buttons, and confirm the saved event count
   remains frozen. Analyze again or reopen the panel to inspect persisted evidence.

Analysis reads a consistent snapshot of at most 1,000 stored events on demand,
and refreshes when the session ends. It does not analyze continuously on every
batch. The panel shows the latest 20 incident summaries; the report is for the
selected incident, not a complete session export. Incidents are derived rather
than stored as a second source of truth. No confidence percentages are calculated.

Initial rules: HTTP 4xx is low severity; HTTP 5xx, network errors/timeouts, uncaught
exceptions, and unhandled rejections are medium. A grouped runtime error keeps
the group at least medium. Aborts and unavailable status 0 alone are not issues.
These labels do not establish how much the user was affected.

Temporal links require the same session/tab/document. The nearest action may be
linked up to 1,000 ms before the request. A runtime event may join a failed response
up to 1,000 ms later only when one failure qualifies and no captured interaction
occurred between them. Competing failures, missing/ambiguous starts, and unrelated
errors remain explicit. Timing is not proof of root cause.

To assess usefulness, repeat this workflow on a real bug and compare the exported
story with what you can establish in DevTools. Missing details due to conservative
redaction and uncertain relationships are deliberate limits to evaluate.

## Foundation design

See [ARCHITECTURE.md](./ARCHITECTURE.md) for execution contexts, permissions,
build decisions, and the connection-check flow. [ROADMAP.md](./ROADMAP.md)
tracks the remaining product work.

## Real application validation

The [Nova assessment](docs/validation/nova.md) records an unchanged application
baseline, a separately labelled simulated model failure, and a Scope lifecycle
bug found during that trial. It also documents the remaining initial-load capture
gap; this trial does not establish a naturally occurring Nova defect.

## Verify Record and reload

Use **Record and reload** when the bug happens during page startup. Click Scope's
Chrome toolbar icon on the target HTTP(S) page first, then press **Record and
reload** in the panel. Scope creates a fresh session and reloads that selected
tab. The panel briefly shows **Preparing reload recording…**, then **Session
active**. Stop and analyze as usual. An existing active session must be stopped
before this action is available. Reloading can discard unsaved page state.

Temporary `document_start` scripts observe startup Fetch/XHR calls and runtime
errors. They use the existing activeTab grant; no new permissions are requested.
Only the confirmed selected tab/document is persisted. Because registration uses
site match patterns, another matching tab with an existing Scope grant can briefly
prepare capture in memory. Its metadata is discarded and APIs restored when its
claim is rejected. Unclaimed preparation expires after five seconds; buffering is
limited to 100 sanitized events. Exceeding that limit interrupts capture rather
than treating a partial buffer as a complete startup history.

The pending reload has a persisted 15-second deadline. Slow/blocked navigation,
lost permissions, or failed startup handshakes can interrupt it. The panel checks
this deadline while preparing; reopening/refreshing it also reconciles stale
state. Scope still records one document: later full navigations/reloads end that
session. HTML document requests, static image/script loads, workers, and iframe
requests are outside Fetch/XHR capture. This feature cannot recover requests
from before the newly armed reload.

Automated coverage in `e2e/reload.spec.ts` checks an inline startup Fetch 503 and
unhandled rejection, document binding, removal of temporary registrations, and
no additional events after Stop.

## Recover from a Scope communication error

If Scope reports a missing/incompatible background response, reload Scope in
`chrome://extensions`, close and reopen its Side Panel, and click **Refresh
session** before starting or reloading again. A rebuilt panel can be newer than
its running worker, but an interrupted channel can cause the same symptom.
Scope does not automatically repeat recording commands because a lost reply
does not prove the command failed to execute.

“No supported failures detected” refers only to a successfully analyzed snapshot.
A normally loading Nova page can legitimately show this. The HTTP 503 in the
validation example was deliberately simulated; it is not built into Nova.
