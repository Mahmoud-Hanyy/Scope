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

Sessions persist lifecycle metadata only. Event capture starts in Phase 3.

## Phase 3 — Capture

- [ ] Capture clicks
- [ ] Capture form submissions
- [ ] Capture relevant input changes
- [ ] Capture navigation
- [ ] Capture Fetch requests
- [ ] Capture XMLHttpRequest
- [ ] Capture JavaScript errors
- [ ] Capture unhandled Promise rejections

## Phase 4 — Event Pipeline

- [ ] Define ScopeEvent
- [ ] Normalize captured events
- [ ] Validate events with Zod
- [ ] Sanitize sensitive information
- [ ] Persist events

## Phase 5 — Storage

- [x] Configure Dexie
- [x] Sessions repository
- [ ] Events repository
- [ ] Issues repository
- [ ] Session deletion
- [ ] Storage limits

## Phase 6 — Timeline

- [ ] Live event timeline
- [ ] Event types
- [ ] Filters
- [ ] Search
- [ ] Event inspector

## Phase 7 — Correlation Engine

- [ ] Define correlation model
- [ ] Interaction → request correlation
- [ ] Request → response correlation
- [ ] Response → error correlation
- [ ] Event chains
- [ ] Confidence scoring
- [ ] Unit tests

## Phase 8 — Detection Engine

- [ ] HTTP failure detector
- [ ] Network failure detector
- [ ] Runtime exception detector
- [ ] Promise rejection detector
- [ ] Slow request detector
- [ ] Duplicate request detector
- [ ] Severity calculation

## Phase 9 — Issues

- [ ] Issues list
- [ ] Issue details
- [ ] Related event visualization
- [ ] Severity filtering

## Phase 10 — Reports

- [ ] Generate debug report
- [ ] Copy report
- [ ] Markdown export
- [ ] JSON export

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
