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
coordinator, content-script bridge, page-context network instrumentation, messaging,
persistent sessions, and interaction capture exist. The event pipeline handles
interaction, Fetch/XHR metadata, and runtime categories. A bounded deterministic
incident analysis and Markdown report checkpoint is implemented; broader analysis
and the full timeline remain planned.

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

Checking the connection installs only the handshake and capture-command handler.
DOM observation begins after an explicit Start session command. The isolated-world
marker prevents repeated checks from registering duplicate listeners. This remains
separate from the injected page-world Fetch/XHR instrumentation.

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
- `src/content/index.ts`: isolated-world handshake and capture-command listener.
- `src/sidepanel/`: React UI and local connection-check state.

Connection status belongs to this component, so React local state is sufficient.
Dexie now persists sessions. Zustand remains deferred: the session hook is owned
by one control component and the database is the authoritative session state.
Zod is used now because TypeScript cannot validate incoming runtime messages.

### Build choice

Vite builds the React HTML entry. `scripts/build.mjs` then uses Vite's library
builds for a module worker and self-contained IIFE content/page scripts. Unlike an
ES module, the classic content script cannot rely on top-level imports; bundling
it separately prevents accidental shared imports in the injected artifact.
The build uses stable `background.js`, `content.js`, and `injected.js` filenames.
The page script is injected with the existing scripting permission in MAIN world;
it does not need a web-accessible resource or additional manifest permissions.

This avoids an additional extension-build framework while there are only four
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
an ID, tab ID, optional Chrome document ID, start time, status, end time, and end
reason. New sessions bind to the document ID returned by Chrome script injection;
legacy rows without it remain readable without a database schema/index change. Status is a
discriminated union: active sessions have no end time/reason; stopped sessions
end through the user's Stop action; interrupted sessions end when their tab
closes, navigates, a capture failure/limit is detected, or the browser restarts.
There are no page URLs, titles, or content fields in session metadata. Validation
rejects extra fields and end times before start.

`src/storage/database.ts` defines versioned Dexie schemas. The `sessions` table
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
records and excludes the current session from pruning. Pruning also deletes the
removed sessions' events in the same transaction. Event ingestion separately
enforces 1,000 events per session.

### Coordination and recovery

`src/background/session-manager.ts` checks the active tab and its handshake before
starting. It reuses `page-connection.ts` so the verified tab ID is the exact ID
stored in the session. It reconciles missing tabs on session reads and registers
tab-close and browser-startup handlers synchronously. Tab-close updates only the
matching active session. Tab loading signals alone cannot distinguish hash links
from a new document: `document-identity.ts` reads Chrome's opaque document ID using
a no-op script, without collecting URLs or titles. Same-document hash/history
changes preserve recording; a changed or inaccessible document ends it. Session
reads also check identity before reactivation, and capture activation verifies
injection results to detect navigation races. Persistence rejects events whose
Chrome sender document ID differs from the session binding. Old unbound sessions
retain the conservative loading-interruption policy. Browser startup interrupts any remaining active session
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
Stopped sessions use their persisted end time. Active sessions now install the
interaction observers described below; capture activation failures interrupt the
session rather than reporting a successful start.

### Tests and remaining scope

Repository tests use `fake-indexeddb`, a development-only implementation of the
IndexedDB API, to test real Dexie transactions, concurrent database connections,
retention, stale Stop requests, idempotency, and reopening storage. Manager tests
cover missing access, tab reconciliation, and lifecycle event handlers. UI tests
cover restoration, operations, errors, and duration calculations. Chromium tests
exercise the built extension with real IndexedDB, including forced worker
termination and subsequent recovery. Actual browser restart is a manual check.

There is no full timeline, history UI, session deletion UI, or automatic permission
regranting yet. Incidents are derived on demand, not stored in an issues table.
One session is shared across the
extension; changing the selected tab does not retarget it.

## User interaction capture

```text
Trusted DOM click / submit / change (top frame)
  → content/interactions.ts → fixed element categories
  → CaptureController → bounded batched runtime message
  → background sender + schema validation
  → core normalization + privacy allowlist
  → EventsRepository transaction (active session / tab / cap / deduplication)
  → IndexedDB → change notification → recent-interaction preview
```

### Capture and privacy

`src/content/element-context.ts` maps native controls and button/link roles to
fixed categories. It never reads values, selected options, checked state,
filenames, names, IDs, text, selectors, labels, form data, or URLs. Every event
explicitly marks `valueOmitted: true`, including password interactions. This
deliberately favors privacy over distinguishing individual buttons in the first
capture slice. Richer element context will require its own privacy design.

`src/content/interactions.ts` uses passive capture-phase listeners so page
handlers retain their default behavior and cannot suppress Scope's observation
by stopping propagation later in the event path. Composed paths handle nested
targets and accessible open shadow roots. Closed roots and iframe capture remain
out of scope. Only interactive clicks, form submissions, and native control
`change` events are recorded. `change` was chosen over per-keystroke `input` to
record committed edits with less overhead. Contenteditable editors are excluded.
`isTrusted` filters script-dispatched events, but is not a security boundary or a
guarantee that a person caused every browser-generated event.

`src/types/event.ts` defines the initial unified ScopeEvent schema. Captured
events have stable UUIDs, epoch-relative high-resolution timestamps, per-observer
sequence numbers, interaction types, and allowlisted element metadata. The
background adds the session ID, authoritative sender tab/document IDs, receive
time, source, and informational severity. Sequence breaks timestamp ties without
inventing an event order from random UUIDs. Later sources will extend this model.
`core/privacy/interactions.ts` reconstructs the metadata allowlist before storage;
Zod also rejects unexpected keys at the message and repository boundaries.

### Batching, reliability, and session transitions

`CaptureController` attaches observers only for a named active session. It buffers
up to 100 pending events plus one in-flight batch, flushes after 200 ms or at 20
events, and sends link clicks/submissions immediately to reduce teardown loss.
Only one batch is in flight. An acknowledgement timeout is five seconds; transport
failure gets one retry with the same IDs. The repository discards existing IDs
without overwriting evidence. Overflow or repeated delivery failure detaches the
observers and reports a capture interruption. There are no idle flush timers,
MutationObservers, per-keystroke messages, or worker keepalive polling.

Session operations are ordered through a background promise queue because their
Chrome API side effects can overlap even when database writes are transactional.
The queue holds no persistent state and is recreated after suspension. Ingestion
is independent of it: Stop detaches the observers and drains/acknowledges pending
batches while the session is still active, then commits the stop time. Making
ingestion wait for the lifecycle queue would deadlock this handshake.

The active-session check and event writes share a transaction on sessions/events.
It rejects wrong-tab, wrong-document, inactive, and stale-session events. Only extension messages
with a top-frame tab/document sender reach ingestion; the page cannot supply its
own tab ID in the payload. The 1,000-event cap interrupts the session atomically.
Capture failures are Scope failures and are never presented as website issues.

Full-page navigation/reload interrupts the session rather than attempting to
record through missing scripts or revoked activeTab grants. A navigation may
destroy the final 200 ms buffer before delivery; capture is explicitly best
effort during teardown. Worker suspension alone leaves the content script alive:
its next batch wakes a worker that reads the active session from IndexedDB.
Session reads reissue an idempotent activation command to recover a start whose
worker was terminated between committing metadata and activating the collector.

### Storage, preview, and verification

Schema version 2 adds an events table without discarding version 1 sessions.
The `[sessionId+timestamp+sequence]` index reads the latest 20 rows in order; the
panel never loads the entire session to render this preview. Session retention
also removes associated events, so event storage cannot grow independently of
the 100-session limit. The UI receives change notifications and refreshes on focus
or user request, while all database access stays behind repository/messaging APIs.

Unit tests cover privacy allowlists, rejected payloads, synthetic-event filtering,
batch retries/overflow, timestamp ties, stopped/wrong-tab rejection, limits,
cascading retention, and schema upgrade. Chromium uses the real playground form,
checks stored payloads for test secrets, verifies page submit behavior, resumes
capture after worker termination, and verifies that Stop/navigation end capture.
See README for the manual workflow and known limits.

Browser references:
[content-script isolated worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
[change events](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event),
[composed paths](https://developer.mozilla.org/en-US/docs/Web/API/Event/composedPath),
and [isTrusted](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted).

## Fetch and XMLHttpRequest capture

```text
Page Fetch / XHR call
  → injected wrappers (MAIN world; redacted metadata only)
  → window.postMessage (untrusted page boundary)
  → content/network-bridge.ts (origin/session/schema validation)
  → CaptureController (one sequence and batch queue for all event types)
  → background/event-ingestion.ts → core/normalization/events.ts
  → EventsRepository → IndexedDB → RecentEvents
```

### Execution context and choice of API

Content scripts cannot replace the website's own Fetch/XHR functions from their
isolated world. The background uses `scripting.executeScript` with `world: MAIN`
to load `injected.js`, then invokes its session-scoped handle. This uses the
existing user-granted activeTab access. `chrome.debugger` was an alternative, but
adds a broader permission and different DevTools integration; intercepting the
page APIs fits the V1 architecture and requires no new dependencies/permissions.

`injected/index.ts` installs one idempotent page-world handle; it does not begin
wrapping APIs merely because the connection was checked. Starting the same
session twice does not double-wrap APIs. The small injected bundle contains no
Zod, React, dynamic evaluation, extension API calls, or remote code. Browser tests
run it under a strict page CSP. Zod validation runs in the isolated content script
and the background, where page code cannot replace its implementation.

### Metadata and privacy

Each observed call emits a `request` event and, if it completes during recording,
a `response` event with the same requestId. The model includes transport, method,
redacted endpoint, status or unavailable status, outcome, and duration. Explicit
request IDs support exact pairing in the incident engine. Captured event severity
stays informational; problem severity is calculated separately. HTTP 4xx/5xx
remain ordinary responses at capture time and become candidates during analysis.

`core/privacy/network.ts` constructs endpoint metadata before it leaves the page
world. It keeps only origin relationship and up to eight fixed allowlisted route
segments. All other segments become `[REDACTED]`; credentials, actual origins,
query strings, fragments, and arbitrary path strings never cross the bridge.
Relative URLs resolve against document.baseURI, while same-origin classification
compares the actual page origin. Unsupported inputs/protocols and URLs longer
than 4,096 characters become unknown. Method names use a fixed allowlist too.
There are no headers, cookies, body readers, response clones, response URL reads,
or error-message capture. The background validates and copies only this schema
before persistence; a forged bridge payload cannot add a raw URL/body/header field.

`types/event.ts` now defines a discriminated union of interaction and network
events. Existing stored interaction events remain valid; no new database version
is needed because network metadata uses the existing event store/index. Generic
pipeline files/messages were renamed from interaction-specific names to events
because normalization, batching, persistence, and the preview serve both sources.

### Preserving application behavior and timing semantics

The Fetch wrapper forwards the original receiver/arguments, returns the original
Response object, leaves its body unread, and rethrows the original rejection
value. It returns an observed promise rather than preserving promise identity;
function identity and native toString appearance also change during recording.
Completion occurs when Fetch settles, generally at response headers, so its
duration does not measure full body download. Accessor-based method options are
reported as OTHER so instrumentation does not invoke their getter a second time.

XHR keeps the constructor/prototype identity and wraps only open/send. Arguments,
including bodies and credentials, are passed through without inspecting them.
WeakMap entries retain only sanitized metadata. Terminal capture-phase listeners
observe load/error/abort/timeout without replacing website callbacks. Duration
ends at that terminal event. Listeners are removed after completion, allowing
reuse of the same instance. XHR opened before recording uses unknown endpoint and
OTHER method rather than inventing metadata that Scope did not observe.

The page observer keeps at most 200 pending observations. Telemetry failure or
capacity overflow disables the observer and signals a Scope capture failure,
while the underlying application call continues. Completed metadata still uses
the shared 1,000-event session cap; a request and its completion count separately.

### Stop, restoration, and trust limits

Stop first restores page APIs, publishing a barrier after already-posted metadata.
The content script waits up to one second for that barrier, removes its bridge
listener, and drains its bounded batch queue before the session end commits.
Stopping never aborts an application request. Pending requests retain an unmatched
start event and their later completion is ignored. Restoration replaces only
functions still owned by Scope, preserving any newer website patches.

On automatic interruption, ingestion acknowledges the content batch before
requesting page cleanup; reversing that order would deadlock against the content
script's flush. The existing navigation/tab/browser interruption policies remain.
Reloading the extension still requires refreshing the webpage to discard stale
content/page instrumentation before starting a new development session.

Bridge origin/source/session checks and schemas prevent accidental cross-frame or
cross-session data mixing. The bridge remains untrusted: the webpage can observe
and forge its own window messages, so routing labels/session IDs are not secrets
and page metadata is not authenticated evidence. No privileged extension operation
is exposed through these messages. The isolated/background session/tab checks and
fixed metadata schema remain the persistence boundary.

Capture covers top-frame calls through the current APIs after recording begins.
Earlier cached API references, frames, workers, resource loads, WebSockets, and
redirect chains are outside this slice. Unusual website wrappers or preexisting
capture-phase listeners may limit observation. The collector is a debugging aid,
not a complete browser network log.

### Verification

Unit tests cover redaction, relative URL resolution, message rejection, stop
barriers, Fetch argument/response/rejection behavior, XHR callbacks/reuse/timeouts,
pending-request limits, and restoration. The network browser test runs under a
strict CSP, verifies real Fetch/XHR successes, HTTP errors, network errors and
aborts, Request objects, pre-opened XHR, body availability, raw IndexedDB privacy,
and an in-flight request finishing successfully after Stop.

References: [Chrome scripting execution worlds](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[Fetch response/error semantics](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch),
[XHR load events](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequestEventTarget/load_event),
and [window messaging](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

## Runtime-to-incident checkpoint

The checkpoint aims to make one bug reproduction understandable and shareable.
It deliberately covers a narrow path rather than completing every timeline,
detector, and reporting feature in the roadmap.

### Runtime capture

`injected/runtime.ts` registers page-world `error` and `unhandledrejection`
listeners during an active session. They do not prevent default behavior or
replace the page's handlers. Resource-load errors and synthetic events are
excluded, as are errors whose filename points into a Chrome extension. Scope's
listener failures are caught and reported through its own capture-failure path.
The existing Stop barrier and detach path now cover both runtime and network
metadata; events raised after Stop are not recorded.

`core/privacy/runtime.ts` classifies built-in Error prototypes without reading
name/message/stack/cause or serializing arbitrary rejection values. Captured
metadata contains only a fixed category, sanitized source endpoint and numeric
line/column when provided by ErrorEvent, and `detailsOmitted: true`. Rejections
have no source position because obtaining it would require reading/parsing stacks.
Cross-realm/custom values may have only a generic category. Browser privacy rules
can suppress cross-origin error details or rejection events; this is not a
complete runtime log. A rejection handled later is still recorded as observed
unhandled at the time of the browser event.

Runtime schemas extend the existing discriminated ScopeEvent union, page bridge,
normalizer, repository, and recent-event preview. The database schema stays at
version 2: no existing event/session data is discarded. Standard captured events
remain informational; severity belongs to a detected problem.

### Detection and severity

`core/detection/problems.ts` produces seeds for HTTP 4xx/5xx responses, network
errors/timeouts, uncaught exceptions, and unhandled rejections. Aborted requests,
successful responses, opaque status 0, and missing status alone do not produce
network issues. HTTP 4xx starts LOW because validation/access-control responses
can be expected. HTTP 5xx, network errors/timeouts, and runtime events start MEDIUM;
impact on users is unknown. A merged runtime seed keeps an incident at least
MEDIUM. No HIGH/CRITICAL labels or probability percentages are invented.

### Deterministic relationships

`core/correlation/incidents.ts` takes plain readonly ScopeEvent data. It sorts a
copy by timestamp, sequence, then ID; it does not mutate its input. Relationships
require the same session, tab, and document:

1. A failed response pairs with exactly one preceding request whose requestId,
   transport, method, and sanitized endpoint agree. Missing or duplicate matches
   remain explicit and do not gain an action link.
2. The nearest preceding click/submit within 1,000 ms of that request may be shown
   as a possible trigger. Other actions in the window are counted and disclosed.
   The normal click-plus-submit pair can therefore produce an ambiguity caveat.
3. A runtime event within 1,000 ms after a failure joins it only if there is exactly
   one candidate failed response and no captured interaction occurred in between.
   Competing failures or intervening interactions keep the runtime error separate.
   Runtime incidents never become anchors for other runtime incidents.

These windows are conservative V1 policy constants, not learned probabilities.
Temporal evidence never establishes causation. Exact request pairing and temporal
action/error links have different labels and explanations in the UI and report.
Stable incident IDs are derived from the anchor event ID, making repeated analysis
of the same evidence deterministic. Successful request chains and more advanced
detectors remain outside this checkpoint.

### Snapshot ownership, performance, and presentation

`EventsRepository.analysisInput` reads the requested session and up to 1,000
events in a single read transaction. `background/analyze-session.ts` runs the pure
engine and validates its result. The authorized Side Panel uses the centralized
`scope/analyze-session` contract; no database logic is put in React.

Incidents are derived rather than stored as a second source of truth. This avoids
stale issue rows as new batches arrive and lets future rule revisions reprocess
original evidence. The initial algorithm uses indexed event-ID lookups and bounded
in-memory scans (worst-case quadratic in the 1,000-event cap), not cubic lookups.
Analysis runs on mount, explicit Analyze session, and session end, rather than on
every captured batch. There is no worker polling or AI dependency.

`use-session-analysis.ts` discards superseded/unmounted responses and regenerates
the selected report only when its analysis/selection changes. `IncidentAnalysis`
shows the latest 20 incident summaries, an ordered sequence, severity reasoning,
and exact/temporal evidence with caveats. It is a snapshot; the user explicitly
reanalyzes after reproducing a bug. The full timeline/search/filter UI is pending.

### Report ownership and export

`core/reporting/event-description.ts` now owns descriptions shared by RecentEvents
and reports, keeping core independent of React. `core/reporting/incidents.ts`
generates Markdown from a selected incident and the same validated snapshot. It
includes event references/relative times, evidence, uncertainty, capture limits,
privacy omissions, session state, and active/event-limit warnings. It claims no
root cause. Raw messages, stacks, rejection values, headers, bodies, or URL details
are never reintroduced for export.

Copy uses the Clipboard API on a user click; failures offer the Markdown download
fallback. Downloads use a Blob and an incident-UUID filename, then revoke the URL.
Neither action sends data to a backend. There is no full-session/JSON export or
persisted report/history workflow yet. Reports with aggressive redaction may need
DevTools inspection to explain precise application details.

### Validation and product checkpoint

Core tests cover canonical chains, sorting/input immutability, context isolation,
time-window edges, competing failures/actions, request ambiguity, severity rules,
standalone errors, privacy and report uncertainty. UI tests cover analysis retry,
session-end refresh, selection and copy/download controls. The browser fixture
reproduces a real form event → POST 500 → unhandled TypeError; it verifies one
explainable incident, native error handlers, actual clipboard/download behavior,
standalone exceptions/rejection values, raw IndexedDB/export privacy, and Stop.

This verifies implementation on controlled fixtures, not market usefulness. The
next checkpoint is to use the report on a real project bug and assess whether it
reduces the effort to understand and communicate the failure. Correlation mistakes
and missing context due to redaction should inform that assessment.

References: [Window error events](https://developer.mozilla.org/en-US/docs/Web/API/Window/error_event)
and [unhandled rejection events](https://developer.mozilla.org/en-US/docs/Web/API/Window/unhandledrejection_event).

## Record and reload

The regular Start workflow remains an immediate, single-document recording.
The explicit `scope/record-and-reload` command instead stores an active session
with optional `reload.expiresAt` metadata and the outgoing document ID. This is
a preparation state, not permission to ingest outgoing-document events. No new
IndexedDB index/version is needed for these optional fields. The repository
rejects event batches until the new document has claimed the session.

The background temporarily registers two packaged scripts at `document_start`,
with `persistAcrossSessions: false`, using the current HTTP(S) host match pattern.
The Chrome activeTab grant gates injection. The MAIN-world bootstrap installs
existing sanitized Fetch/XHR/runtime observers immediately and retains at most
100 events in memory for five seconds. The ISOLATED-world bootstrap installs the
ordinary content controller and sends `scope/claim-reload`. The background checks
extension ID, top frame, Chrome tab/document sender metadata, and the current
Chrome document identity. A repository transaction claims a pending session only
once, in its selected tab, with a different document ID and before its deadline.
Only then can captured data enter the existing normalization/persistence pipeline.

```text
Panel → background → persist preparation → register early scripts → reload tab
New document, MAIN: install observers → bounded sanitized buffer
New document, ISOLATED: background claim → bind document → start content bridge
MAIN: claim message → replay buffered metadata → normal live publication
Background: unregister temporary scripts
Stop → restore page APIs → drain content batches → persist stopped session
```

Dynamic registrations accept URL patterns, not tab IDs. Another already granted
matching tab can briefly prepare sanitized metadata; its claim is rejected and
its memory buffer discarded. Nothing from that tab enters the session. This
tradeoff avoids mandatory broad host permissions or debugger attachment, which
would interfere with the DevTools companion workflow. Registration matching
ignores ports; Chrome's actual host/access checks and selected-tab claim remain
the authoritative gates. No URL, query, title, or origin is persisted in session
metadata; the transient registration uses only the HTTP(S) scheme/hostname.

Preparation times out locally after five seconds. Buffer overflow restores the
observers and reports a Scope capture failure on claim. A delayed content reply
past its local deadline reports failure rather than silently starting late.
Stop remembers its session ID in the page handle so a delayed claim cannot
restart that stopped session. The background's persisted 15-second preparation
deadline is reconciled on reads/lifecycle updates; the panel polls only while
preparing. Worker suspension therefore does not lose the pending state. Tab
closure/browser startup and cancellation remove the temporary registrations;
failed setup also interrupts the pending session. No in-memory worker timer is
required for correctness. If no worker activity or panel remains, reconciliation
can be delayed; the page's bounded preparation still expires independently.

After binding, the normal one-document lifecycle resumes: hash/history changes
continue; a later full navigation interrupts. Correlation remains plain core
logic and can compare only events in the confirmed document. Early replay does
not establish causation or authenticate page-context metadata. Capture remains
Fetch/XHR and top-document runtime observation, not a complete browser network
trace. The HTML navigation itself, static resource loads, frames, and workers are
not added by this feature.

### Missing or incompatible runtime replies

`src/messaging/request.ts` owns the Side Panel's transport/validation boundary.
It distinguishes a rejected Chrome message channel, an undefined response, and
a response that fails its expected Zod schema. All four client operations use
this boundary. These cases produce a typed `ScopeMessageError` with recovery
instructions; the original transport/validation error remains its diagnostic
cause. UI layers may display this controlled error text, while retaining generic
fallbacks for arbitrary failures. Missing analysis data is not converted into
an empty successful analysis.

An older worker can ignore a newer command while still handling older requests;
a rebuilt Side Panel loaded beside such a worker can therefore display a prior
valid snapshot and fail a subsequent session operation. A channel interruption
can also lose a reply, so an undefined response alone does not establish version
mismatch. Reload the unpacked extension, close/reopen the Side Panel, and refresh
the session to reconcile IndexedDB before attempting a mutation again. There
is no automatic retry: a recording/reload command may have executed before its
reply disappeared.

`e2e/messaging-recovery.spec.ts` tests this by loading a temporary extension copy
whose worker ignores only the new reload command. It verifies actionable UI
feedback, retention of the prior stopped session, a single command submission,
no page reload, and successful state refresh. The real build is not modified by
the test. Unit coverage verifies all four client boundaries and ensures failed
analysis is not presented as zero incidents.
