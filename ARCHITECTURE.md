# Scope Architecture

## Core Principle

Scope separates browser data collection from analysis and presentation.

## High-Level Architecture

Page Context
↓
Injected Script
↓
Content Script
↓
Background Service Worker
↓
Core Engine
↓
IndexedDB
↓
Side Panel

## Layers

### Injected Script

Captures information that requires access to the website's JavaScript
execution context.

Examples:

- fetch
- XMLHttpRequest
- console
- runtime errors

### Content Script

Observes the page and acts as a bridge between the page context and
the extension.

Examples:

- user interactions
- DOM context
- navigation events

### Background Service Worker

Coordinates extension-level operations.

Examples:

- session lifecycle
- message routing
- Chrome APIs

### Core Engine

Processes captured information.

Pipeline:

Capture
→ Normalize
→ Validate
→ Sanitize
→ Persist
→ Correlate
→ Detect

### Storage

IndexedDB using Dexie.

Stores:

- Sessions
- Events
- Issues

### Side Panel

React application used to control and inspect Scope.

Contains:

- Recording controls
- Timeline
- Event inspector
- Issues
- Session history
- Settings

## Current implementation: extension foundation

The layers above describe the target architecture. The Side Panel, background
coordinator, content-script bridge, messaging contracts, and persistent session
lifecycle exist. Core processing and event storage will follow event capture.

### Connection check

```text
Side Panel button
  → runtime.sendMessage(scope/check-connection)
  → Background validates the message and verifies the sender is our Side Panel
  → Query the active tab and inject content.js into its isolated world
  → tabs.sendMessage(scope/page-ping) to the top frame
  → Content script validates the message and replies scope/page-ready
  → Background validates the reply and returns connection status
  → Side Panel validates the response and displays it
```

The content script is deliberately limited to a handshake. It observes no DOM
events and reads no page content. Its isolated-world marker prevents repeated
checks from registering duplicate listeners. It is not an injected page-world
script; website API instrumentation will require a separate implementation.

### Permissions and lifecycle

The manifest requests `sidePanel`, `activeTab`, and `scripting`. Clicking Scope's
toolbar action opens the panel and grants temporary access to that tab. The
worker explicitly handles `chrome.action.onClicked` and calls `sidePanel.open`
synchronously, preserving the toolbar's user gesture. Automatic panel opening
(`openPanelOnActionClick`) is disabled on worker startup, including upgrades from
the original foundation: automatic panel opening bypassed the permission grant
in the reproduced failure. This keeps the fix within the existing permissions.
`activeTab` was chosen over permanent host permissions to keep this initial
access user initiated. A panel remaining open while tabs change does not grant
access to the new tab; the user must invoke Scope there. Restricted Chrome pages
remain unavailable. No `tabs` permission is needed to query the active tab ID;
Scope does not read protected tab metadata.

The worker installs message listeners synchronously at module evaluation. It
keeps each asynchronous reply channel open by returning `true` from the listener.
Session state lives in IndexedDB, so worker suspension does not lose the current
session. See the session lifecycle design below for restart and tab-close behavior.

### Files and ownership

- `src/messaging/contracts.ts`: Zod schemas and inferred TypeScript message types.
- `src/messaging/client.ts`: Side Panel transport and response validation.
- `src/background/index.ts`: worker entry and toolbar/panel behavior.
- `src/background/message-router.ts`: sender checks and page handshake coordination.
- `src/content/index.ts`: isolated-world handshake listener.
- `src/sidepanel/`: React UI and local connection-check state.

Connection status belongs to this component, so React local state is sufficient.
Dexie now persists sessions. Zustand remains deferred: the session hook is owned
by one control component and the database is the authoritative session state.
Zod is used now because TypeScript cannot validate incoming runtime messages.

### Build choice

Vite builds the React HTML entry. `scripts/build.mjs` then uses Vite's library
builds for a module worker and a self-contained IIFE content script. Unlike an
ES module, the classic content script cannot rely on top-level imports; bundling
it separately prevents accidental shared imports in the injected artifact.
The manifest uses stable `background.js` and `content.js` filenames.

This avoids an additional extension-build framework while there are only three
entry points. The cost is explicitly maintaining this small build script and
rebuilding/reloading Chrome during extension development. The Vite dev server
previews the UI only; it is not loaded remotely into the extension.

### Validation boundaries

Vitest covers malformed messages, sender restrictions, injection failures,
duplicate listener prevention, visible panel states, and synchronous toolbar
handling. The Chromium smoke test covers both missing access and two successful
page handshakes after invoking the real toolbar action through CDP. The README
steps verify the actual toolbar and Side Panel UI in the user's Chrome.

Access/injection failures and content-script handshake failures return separate
typed reasons. The panel gives recovery instructions without exposing raw browser
error text or page URLs. Scope's own coordination failures also have a distinct
reason; full diagnostic errors remain in its service worker console.

## Session lifecycle

```text
SessionControls → useSession → validated runtime message
  → background message router → session manager
  → sessions repository → Dexie transaction → IndexedDB
  → validated reply + change notification → Side Panel
```

### Ownership and persistence

`src/types/session.ts` defines the runtime-validated domain model. Sessions have
an ID, tab ID, start time, status, end time, and end reason. Status is a
discriminated union: active sessions have no end time/reason; stopped sessions
end through the user's Stop action; interrupted sessions end when their tab
closes or a browser restart is detected. There are no page URLs, titles, or
content fields. Validation rejects extra fields and end times before start.

`src/storage/database.ts` defines Dexie schema version 1. The `sessions` table
holds metadata; `sessionState` holds a singleton pointer to the current session.
The pointer makes the current record explicit even when timestamps tie or the
wall clock changes. `src/storage/repositories/sessions.ts` owns all database
access. It validates reads and writes and uses read/write transactions spanning
both tables to enforce one active session across concurrent requests/connections.
Chrome storage could hold this small metadata set, but IndexedDB was chosen to
keep session persistence in the same repository architecture as future events
and issues, without introducing a second persistent source of truth.
No Chrome API calls run inside these transactions, because waiting on unrelated
asynchronous work can let an IndexedDB transaction become inactive.

Repeated Start returns the existing active session, preserving its target tab.
Stop includes the expected session ID: a stale panel cannot stop a newer session.
Repeated Stop preserves the original end time. A successful response is sent
only after the transaction commits. The repository retains at most 100 metadata
records and excludes the current session from pruning. This limit applies only
to metadata; captured-event limits will need their own policy.

### Coordination and recovery

`src/background/session-manager.ts` checks the active tab and its handshake before
starting. It reuses `page-connection.ts` so the verified tab ID is the exact ID
stored in the session. It reconciles missing tabs on session reads and registers
tab-close and browser-startup handlers synchronously. Tab-close updates only the
matching active session; browser startup interrupts any remaining active session
because tab IDs can be reused across browser runs. Worker module evaluation does
not interrupt sessions: a worker waking from suspension is not a browser restart.

The interruption timestamp records when Scope detected the interruption. A
browser-restart duration is deliberately unavailable because the offline interval
is not measured. A tab-close event received during browser shutdown can end the
session first, with a tab-closed reason. A backwards wall-clock adjustment is
clamped so durations never become negative; wall-clock changes can still affect
elapsed duration. More precise cross-context event clocks belong to capture work.

### Panel state and timer

`src/sidepanel/hooks/use-session.ts` loads the current session on mount, on focus,
on explicit refresh, and on validated worker change notifications. It ignores
superseded asynchronous replies and defers refresh notifications received during
a mutation until that mutation finishes. It does not poll the worker or keep a
long-lived messaging port open. Closing the panel leaves the session active.

The React timer only updates display state once per second while a session is
active. `session-duration.ts` derives elapsed time from timestamps, rather than
counting timer ticks, so a throttled or closed panel does not lose elapsed time.
Stopped sessions use their persisted end time. A session being active does not
yet mean event listeners are recording: the UI explicitly says capture comes next.

### Tests and remaining scope

Repository tests use `fake-indexeddb`, a development-only implementation of the
IndexedDB API, to test real Dexie transactions, concurrent database connections,
retention, stale Stop requests, idempotency, and reopening storage. Manager tests
cover missing access, tab reconciliation, and lifecycle event handlers. UI tests
cover restoration, operations, errors, and duration calculations. Chromium tests
exercise the built extension with real IndexedDB, including forced worker
termination and subsequent recovery. Actual browser restart is a manual check.

There is no capture, history UI, session deletion UI, or automatic permission
regranting yet. One session is shared across the extension; changing the selected
tab does not retarget it. Future capture must obey the saved target tab, validate
event messages, sanitize before persistence, and handle page access being revoked
on cross-origin navigation.
