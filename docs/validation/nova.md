# Nova trial — 2026-11-01

## Purpose and setup

Assess Scope against an existing application rather than only its playground.
Nova is a React/Three.js product showcase. Its 3D model is preloaded during page
startup, navigation uses section anchors, and the shop has mail links rather
than a live checkout/API workflow. No naturally occurring Nova defect was
established in this trial.

The existing Nova production build was served read-only from the sibling
`Nova/dist` directory on `http://127.0.0.1:4178`. No Nova source/build files were
changed. Chromium loaded Scope's production extension in a temporary profile;
Playwright triggered the actual toolbar action to grant page access. Testing was
automated and headless, not a manual test in the developer's everyday Chrome
profile. No mail links were activated.

## Findings

| Scenario                                            | Observation                                                                                             | Meaning                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unchanged desktop/mobile navigation, before the fix | First hash link interrupted Scope; only 1 click persisted                                               | A real Scope lifecycle bug, unrelated to a Nova failure                                              |
| Same navigation, after the fix                      | 8 clicks persisted; stopped by user; 0 incidents                                                        | Hash links and mobile menu interactions continue recording                                           |
| Full reload                                         | Recording interrupts                                                                                    | Scope still records one document, not an entire navigation journey                                   |
| Simulated model HTTP 503                            | Nova displayed its scene fallback; Scope recorded 1 uncaught exception and 1 standalone MEDIUM incident | Runtime capture works in this failure path, but the report does not explain the failed model request |

The final reload check ended with `page-navigation`. TypeScript, lint, formatting,
94 unit tests, the production build, and all four Playwright extension workflows
passed. The final Nova scenarios were repeated against that build. Sanitized
summary counts are retained in [nova-results.json](nova-results.json).

The baseline had no browser uncaught errors and no visible scene-error fallback.
One console error was observed; its cause was not established. Console capture
is not implemented, so zero incidents must not be interpreted as proof that the
application had no problems.

For the simulated failure, Playwright held an existing `.glb` request until Scope
started recording, then returned HTTP 503. The request began before Scope's
Fetch instrumentation was installed. Consequently, Scope captured neither the
request nor its response, even though the response arrived during recording.
Browser-level observation confirmed the 503; the Scope report contains only the
runtime exception. This was an intentional fault injection, not a discovered
production bug or evidence that React error boundaries always emit uncaught
errors.

## Scope fix and architecture

Previously, any Chrome tab `loading` signal ended recording. A hash navigation
can produce that signal while the underlying document stays alive. New sessions
now store Chrome's opaque document ID returned by script injection. The
background compares document identity on lifecycle updates and recovery:

```text
Same tab + same document → retain recording
Same tab + new/inaccessible document → interrupt recording
Captured batch from another document → reject before persistence
```

The check executes a no-op script and reads Chrome's injection metadata; it does
not read the website URL/title or trust a page-supplied identity. Capture
activation also checks injection results for a document change. A reattachment
failure racing a reload is classified as navigation when the tab is loading or
Chrome reports a different document. Missing positive navigation evidence keeps
the capture-error classification.

This belongs in the background lifecycle and storage boundary. React displays
the resulting session state. Optional metadata preserves old saved sessions
without a database index/schema upgrade; old active sessions retain conservative
navigation handling. No permissions or dependencies were added. Identity checks
add a small script-injection round trip on session recovery/lifecycle updates,
not on every event.

A full navigation recorder would be a larger feature requiring early injection,
permission decisions, and a multi-document session model. That was deliberately
left for a separate milestone.

## Verification and repeat steps

Unit tests cover unchanged and changed document identities, unavailable
documents, reload/reattachment races, persisted bindings, and rejected batches.
`e2e/document-navigation.spec.ts` verifies two hash links, `pushState`, and
`replaceState` preserve the session and five clicks; reload interrupts and
subsequent clicks do not grow that session. The existing foundation, network,
and incident browser workflows also remain part of verification.

To repeat the baseline manually:

1. Build Scope with `npm run build` and reload it in `chrome://extensions`.
2. Serve the existing Nova build from a separate terminal:
   `python3 -m http.server 4178 --bind 127.0.0.1 --directory ../Nova/dist`.
3. Open `http://127.0.0.1:4178`, let it load, click Scope's toolbar icon, and start.
4. Click Gallery, Shop, About, Home in desktop navigation. In a narrow viewport,
   click Open menu → Shop, then Open menu → Home.
5. Stop and refresh events. Expect eight clicks and the user stop reason.
6. Start again and reload Nova. Expect a navigation interruption. Starting again
   after the reload cannot recover network calls that already began.

The evaluation artifacts under `test-results/nova-validation/` contain summary
counts, screenshots, and a downloaded sanitized incident report. Playwright
clears `test-results` on a fresh suite run; retain anything needed before running
it again.

## Product implication

This trial improved Scope's correctness but only partially validated its ability
to explain a real application's failure. The next useful milestone is an explicit
record-and-reload workflow that captures initial-load requests, with conservative
permissions and clear document boundaries. Then repeat this model-load scenario
and expect a failed response plus runtime evidence, without asserting causation
from timing alone. A separate application with a reproducible interaction-driven
API failure would provide stronger evidence for the existing correlation engine.

## Follow-up — Record and reload, 2026-11-02

The initial-load gap above is now addressed for an explicitly armed reload.
Against the unchanged Nova production build, the new workflow captured three
events in the selected new document: Fetch request, HTTP 503 response, and an
uncaught runtime exception. The deterministic engine produced one MEDIUM incident
with an exact request/response link and a possible runtime link 362.4 ms later.
The session stopped by user action and zero temporary scripts remained.

The model response was intentionally replaced with HTTP 503 in the browser test;
this remains a simulated failure, not a naturally occurring Nova defect. Compare
the prior standalone runtime report with the new
[sanitized incident](nova-reload-incident.md) and
[summary evidence](nova-reload-results.json). General navigation recording and
capture of resources outside top-document Fetch/XHR remain out of scope.

The follow-up used a fresh temporary Chromium extension profile. It loaded Nova
normally, installed a browser route returning 503 for the next model request,
clicked Scope's real toolbar action, and pressed Record and reload. It then
waited for Nova's fallback, stopped Scope, analyzed, and downloaded the Markdown
report. No application sources or build assets were edited.

Files to study for this milestone:

- `src/background/reload-scripts.ts`: temporary early-script registration and removal.
- `src/background/session-manager.ts`: prepare, reload, claim, cancel, and recovery coordination.
- `src/storage/repositories/sessions.ts`: transactional one-time document claim.
- `src/storage/repositories/events.ts`: reject events before the document is bound.
- `src/messaging/reload.ts` and `contracts.ts`: validate startup claims and panel commands.
- `src/injected/index.ts`: bounded early buffer, replay, API restoration, and delayed-start rejection after Stop.
- `src/reload-injected/index.ts`: MAIN-world preparation and claim listener.
- `src/reload-content/index.ts`: ISOLATED-world background handshake and bridge startup.
- `src/content/index.ts`: expose the one controller within the isolated world for both startup paths.
- `src/sidepanel/hooks/use-session.ts`: invoke the operation and reconcile preparation deadlines.
- `src/sidepanel/components/SessionControls.tsx`: action, preparation state, and control availability.
- `src/types/session.ts`: backward-compatible optional preparation metadata.
- `scripts/build.mjs`: produce the two independent classic-script entry points.
- `e2e/reload.spec.ts`: verify inline startup failure capture and cleanup in Chromium.

Notice the ownership boundaries: MAIN observes page APIs; ISOLATED validates and
forwards metadata; the worker verifies Chrome identities; the repository commits
the document binding. Early observations can precede that asynchronous handshake,
so the small sanitized buffer is necessary. It is not persistent session data
until the handshake succeeds. The alternative of attaching Chrome's debugger was
avoided to keep Scope compatible with the normal DevTools workflow. No mandatory
host permission, new dependency, or backend was introduced.
