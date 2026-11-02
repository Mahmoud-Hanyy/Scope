# Scope Development Roadmap

## Phase 1 — Foundation

- [x] Initialize React + TypeScript + Vite
- [x] Configure Tailwind CSS
- [x] Configure Manifest V3
- [x] Create Chrome Side Panel
- [x] Create background service worker
- [x] Create content script
- [x] Establish extension messaging
- [x] Configure ESLint and Prettier
- [x] Configure testing

Foundation implementation includes a connection handshake, not event recording.
The README lists the remaining manual Chrome toolbar/access checks.

## Phase 2 — Sessions

- [x] Define session model
- [x] Start debugging session
- [x] Stop debugging session
- [x] Track active session
- [x] Session timer

Session lifecycle now controls the interaction capture added in Phase 3.

## Phase 3 — Capture

- [x] Capture clicks
- [x] Capture form submissions
- [x] Capture relevant input changes
- [ ] Capture navigation
- [x] Capture Fetch requests
- [x] Capture XMLHttpRequest
- [x] Capture JavaScript errors
- [x] Capture unhandled Promise rejections

## Phase 4 — Event Pipeline

- [x] Define ScopeEvent
- [x] Normalize captured events
- [x] Validate events with Zod
- [x] Sanitize sensitive information
- [x] Persist events

These stages cover interaction, Fetch/XHR metadata, and runtime categories/source
positions. Raw error messages/stacks/rejection values are omitted. Full-document
navigation interrupts recording; same-document hash/history changes preserve it.
Navigation event capture is still pending. The Nova trial exposed the remaining
initial-load/reload capture gap; see [the assessment](docs/validation/nova.md).

## Phase 5 — Storage

- [x] Configure Dexie
- [x] Sessions repository
- [x] Events repository
- [ ] Issues repository
- [ ] Session deletion
- [x] Storage limits

Current limits: 100 sessions, 1,000 events per session, with cascading retention.
The latest-20 interaction preview is implemented; the full timeline remains below.

## Phase 6 — Timeline

- [ ] Live event timeline
- [ ] Event types
- [ ] Filters
- [ ] Search
- [ ] Event inspector

## Phase 7 — Correlation Engine

- [x] Define correlation model
- [x] Interaction → request correlation
- [x] Request → response correlation
- [x] Response → error correlation
- [x] Event chains
- [ ] Confidence scoring
- [x] Unit tests

Initial correlation covers failed-request incidents only. Links show explicit
evidence and ambiguity; temporal links do not assert causation. Confidence scoring
is intentionally deferred. See ARCHITECTURE.md for the deterministic windows/rules.

## Phase 8 — Detection Engine

- [x] HTTP failure detector
- [x] Network failure detector
- [x] Runtime exception detector
- [x] Promise rejection detector
- [ ] Slow request detector
- [ ] Duplicate request detector
- [x] Severity calculation

## Phase 9 — Issues

- [x] Issues list
- [x] Issue details
- [ ] Related event visualization
- [ ] Severity filtering

## Phase 10 — Reports

- [x] Generate debug report
- [x] Copy report
- [x] Markdown export
- [ ] JSON export

The incident checkpoint derives issues on demand and exports one selected
incident. Persistent issues/history, full-session export, graph visualization,
filtering, broader detection, and real-project usefulness validation remain.

## Phase 11 — Hardening

- [ ] Unit tests
- [ ] Integration tests
- [ ] Playwright extension tests
- [ ] Performance testing
- [ ] Privacy testing
- [ ] Edge cases
- [ ] Production build

## Phase 12 — Release

- [ ] Extension icons
- [ ] Store screenshots
- [ ] Privacy documentation
- [ ] Chrome Web Store package
- [ ] Public README

## Startup capture checkpoint

- [x] Explicit Record and reload action with persisted preparation deadline
- [x] Early bounded Fetch/XHR/runtime buffering and selected-document claim
- [x] Remove temporary scripts and preserve Stop/document boundaries
- [x] Browser regression for inline startup failure and privacy omissions

This enables startup capture for the selected reload; general multi-document
recording/navigation events remain future work. See README for coverage limits.
