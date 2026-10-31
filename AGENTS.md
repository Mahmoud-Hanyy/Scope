# Scope — AI Agent Engineering Guide

## 1. Project

**Scope** is a Chrome debugging companion for frontend developers.

Scope records what happens while a developer reproduces a bug and connects related browser events into a readable debugging timeline.

The fundamental workflow is:

```text
Record
  ↓
Capture
  ↓
Normalize
  ↓
Sanitize
  ↓
Correlate
  ↓
Detect
  ↓
Explain
  ↓
Report
```

Scope should answer:

> What happened, in what order, and which events are probably related?

Scope is **not** intended to replace Chrome DevTools.

Chrome DevTools exposes debugging data.

Scope's purpose is to connect that data and tell the story of a bug.

---

# 2. Primary Goal

Build Scope as a serious software-engineering project while ensuring that the developer understands every important implementation decision.

The AI agent must therefore optimize for:

1. Correctness
2. Maintainability
3. Clear architecture
4. Performance
5. Privacy
6. Testability
7. Developer understanding

Do not optimize purely for implementation speed.

---

# 3. Developer Learning Requirement

This requirement is extremely important.

The developer does not want the AI agent to silently implement features.

For every meaningful task, the agent must make the implementation understandable.

The developer should be able to explain:

* What was changed?
* Why was it necessary?
* How does it work?
* Where does it fit into Scope's architecture?
* What browser/JavaScript concept does it rely on?
* What alternatives existed?
* Why was this implementation chosen?
* How can the implementation be tested?

Do not introduce important architecture, abstractions, libraries, patterns, or browser APIs without explaining their purpose.

---

# 4. Technology Stack

## Core

* TypeScript
* React
* Vite
* Tailwind CSS

## Chrome Platform

* Chrome Extension Manifest V3
* Side Panel API
* Content Scripts
* Background Service Worker
* Chrome Runtime Messaging
* Chrome Tabs APIs where required

## State

* Zustand

Use Zustand for application/UI state where global state is actually required.

Do not put every value into global state.

Prefer local React state for component-specific state.

## Validation

* Zod

Use Zod at important runtime boundaries, particularly when data crosses execution contexts or enters Scope from an external/imported source.

## Persistence

* IndexedDB
* Dexie.js

IndexedDB stores debugging sessions because sessions may contain thousands of events and are not appropriate for simple localStorage persistence.

## Testing

* Vitest
* React Testing Library
* Playwright

## Quality

* ESLint
* Prettier

## CI

* GitHub Actions

---

# 5. Architecture

Maintain clear separation between browser contexts and application layers.

```text
Scope
│
├── Side Panel
│   └── User interface
│
├── Content Script
│   └── DOM and user interaction observation
│
├── Injected Page Script
│   └── Page-context instrumentation
│
├── Background Service Worker
│   └── Coordination and session lifecycle
│
├── Messaging Layer
│   └── Communication between contexts
│
├── Core Engine
│   ├── Normalization
│   ├── Sanitization
│   ├── Correlation
│   ├── Detection
│   └── Reporting
│
└── Storage Layer
    └── IndexedDB / Dexie
```

Do not blur these responsibilities simply because putting code somewhere else is easier.

---

# 6. Execution Contexts

Understanding Chrome extension execution contexts is fundamental to Scope.

The agent must preserve the distinction between:

### Page Context

JavaScript belonging to the website being debugged.

Used when Scope must instrument APIs belonging to the actual page.

### Content Script

Runs in Chrome's isolated extension environment while having access to the page DOM.

Responsible primarily for:

* User interactions
* DOM information
* Page-related event collection
* Communication between injected code and the extension

### Background Service Worker

Responsible for extension-level coordination.

Examples:

* Session lifecycle
* Message routing
* Extension state coordination
* Chrome APIs requiring extension privileges

Do not assume the background service worker remains alive permanently.

Manifest V3 service workers can be suspended.

Persistent information must therefore live in an appropriate persistence layer rather than depending exclusively on in-memory variables.

### Side Panel

The React application presented to the developer.

It should display data and invoke application operations.

Do not place core debugging logic inside React components.

---

# 7. Intended Project Structure

Prefer the following organization:

```text
src/
├── background/
│   ├── index.ts
│   ├── session-manager.ts
│   └── message-router.ts
│
├── content/
│   ├── index.ts
│   ├── interactions.ts
│   ├── navigation.ts
│   └── element-context.ts
│
├── injected/
│   ├── network.ts
│   ├── console.ts
│   └── errors.ts
│
├── sidepanel/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   └── stores/
│
├── core/
│   ├── correlation/
│   ├── detection/
│   ├── normalization/
│   ├── privacy/
│   └── reporting/
│
├── storage/
│   ├── database.ts
│   └── repositories/
│
├── messaging/
├── types/
└── utils/
```

This structure may evolve if there is a strong architectural reason.

If changing it, explain why before making a major restructuring.

---

# 8. Core Domain Model

All captured information should eventually become a normalized Scope event.

Conceptually:

```ts
interface ScopeEvent {
    id: string;
    sessionId: string;
    type: ScopeEventType;
    source: EventSource;
    timestamp: number;
    severity: Severity;
    data: unknown;
}
```

Possible event types include:

```ts
type ScopeEventType =
    | "click"
    | "input"
    | "submit"
    | "navigation"
    | "request"
    | "response"
    | "console"
    | "exception"
    | "promise-rejection";
```

These definitions are conceptual starting points, not immutable specifications.

Improve them when necessary, but preserve the idea of a unified event model.

---

# 9. Event Pipeline

Captured events should move through a predictable pipeline:

```text
Browser Event
      ↓
Capture
      ↓
Normalize
      ↓
Validate
      ↓
Sanitize
      ↓
Persist
      ↓
Correlate
      ↓
Detect
      ↓
Present
```

Each stage should have a clear responsibility.

Avoid large functions that perform several stages simultaneously.

---

# 10. Capture Layer

Scope should eventually capture:

## User Events

* Click
* Submit
* Relevant input/change events
* Navigation
* Reload/history changes

Avoid unnecessary high-frequency events such as mouse movement.

## Network

Initially:

* fetch
* XMLHttpRequest

Relevant information includes:

* URL
* HTTP method
* status
* duration
* timestamp
* sanitized metadata

## Runtime

* console.error
* console.warn where useful
* uncaught JavaScript errors
* unhandled Promise rejections

Capture only information useful for debugging.

Scope must not become a generic telemetry collector.

---

# 11. Privacy Rules

Privacy is a core architectural requirement, not a later feature.

Never intentionally persist:

* Passwords
* Authentication tokens
* Session cookies
* API secrets
* Authorization headers
* Sensitive form values

Sensitive information should be sanitized **before persistence whenever possible**.

Examples:

```text
Authorization: Bearer abc123
```

must become:

```text
Authorization: [REDACTED]
```

A password field interaction should record that the field changed, not its value.

Be conservative when uncertain whether information may be sensitive.

Any feature that increases data capture must consider its privacy implications.

---

# 12. Correlation Engine

The correlation engine is one of Scope's main technical differentiators.

Its responsibility is to determine probable relationships between events.

Example:

```text
Click
  ↓
POST /api/orders
  ↓
500 Response
  ↓
TypeError
```

These should not appear merely as four unrelated records.

Scope should determine that they may belong to the same debugging incident.

V1 should favor deterministic rules and heuristics over AI.

Potential signals:

* Temporal proximity
* Same tab/document
* Interaction followed by network activity
* Submit followed by POST/PUT/PATCH
* Request/response identifiers
* Failed response followed by runtime exception
* Navigation relationships

Keep correlation logic independent from React.

The engine should be testable using plain TypeScript data.

---

# 13. Confidence

Correlations may include a confidence value when appropriate.

Conceptually:

```text
Click → POST /api/orders

Confidence: 94%
```

The score must be based on explicit evidence.

Do not invent arbitrary percentages solely for UI purposes.

If confidence scoring is implemented, the calculation must be deterministic, documented, and tested.

---

# 14. Detection Engine

Correlation answers:

> Which events are related?

Detection answers:

> Does this sequence indicate a problem?

Initial detectors may include:

* HTTP 4xx/5xx
* Network failure
* JavaScript exception
* Unhandled Promise rejection
* Slow request
* Duplicate request
* Failed user action

Detection rules belong in the core engine.

They should not be hard-coded into UI components.

---

# 15. Severity

Issues may eventually use:

```text
INFO
LOW
MEDIUM
HIGH
CRITICAL
```

Severity rules must have clear reasoning.

Do not mark everything as HIGH or CRITICAL simply to make the interface appear dramatic.

---

# 16. Storage

Use IndexedDB through Dexie.

Conceptual entities:

```text
Session
Event
Issue
```

A session contains many events and detected issues.

Storage access should go through a storage/repository layer.

Avoid direct database calls scattered throughout React components and capture modules.

---

# 17. UI Principles

Scope should feel like a professional developer tool.

Prioritize:

* Information hierarchy
* Readability
* Dense but understandable information
* Fast navigation
* Clear severity indicators
* Useful empty states
* Responsive extension layout
* Accessibility

Avoid excessive decorative UI that makes debugging information harder to inspect.

The Side Panel is Scope's primary interface.

---

# 18. State Management

Do not confuse persistent data with UI state.

Examples:

### IndexedDB

Use for:

* Sessions
* Captured events
* Issues
* Reports

### Zustand

Use for appropriate shared application state such as:

* Selected session
* Active filters
* Recording UI state when appropriate
* Current view state

### React Local State

Use for:

* Modal visibility
* Temporary form values
* Component-local interactions

---

# 19. Messaging

Communication between:

```text
Injected Script
Content Script
Background Worker
Side Panel
```

must use well-defined typed messages.

Avoid arbitrary strings scattered throughout the codebase.

Prefer a central message contract.

Conceptually:

```ts
type ScopeMessage =
    | StartSessionMessage
    | StopSessionMessage
    | CapturedEventMessage
    | SessionUpdatedMessage;
```

Validate untrusted/runtime boundaries where appropriate.

---

# 20. Performance

Scope is debugging another application.

It must not become the reason that application becomes slow.

Avoid:

* Recording mousemove continuously
* Excessive MutationObservers
* Serializing huge objects unnecessarily
* Writing to IndexedDB for every tiny event without considering batching
* Expensive calculations on every render
* Capturing response bodies by default
* Unlimited session growth

When implementing capture functionality, consider runtime overhead.

If a design trades performance for convenience, explicitly discuss the tradeoff.

---

# 21. Error Handling

Do not silently swallow errors.

Errors should be handled at the correct layer.

Distinguish between:

* Errors in the website being debugged
* Errors produced by Scope itself

Scope's own failures must never be presented as application failures.

Logging should make this distinction obvious during development.

---

# 22. TypeScript Rules

Use TypeScript properly.

Avoid:

```ts
any
```

unless there is a concrete reason.

Prefer:

* Explicit domain types
* Discriminated unions
* Narrow interfaces
* Type guards
* `unknown` at uncertain boundaries
* Runtime validation where compile-time types are insufficient

Do not use type assertions merely to silence compiler errors.

Fix the underlying type model when possible.

---

# 23. React Rules

React is the presentation layer.

Components should not:

* Implement event correlation
* Directly instrument browser APIs
* Contain persistence logic
* Perform complex detection algorithms

Prefer:

```text
Component
    ↓
Hook / Store
    ↓
Application/Core Layer
    ↓
Repository / Messaging
```

Keep components reasonably small.

Extract components when doing so improves clarity or reuse, not merely to reduce line counts.

---

# 24. Dependencies

Do not install a package simply because it solves a small problem.

Before introducing a dependency, determine:

1. What problem does it solve?
2. Can the platform or existing stack solve it cleanly?
3. What runtime/bundle cost does it introduce?
4. Is it actively maintained?
5. Does it introduce unnecessary complexity?

For meaningful new dependencies, explain the reasoning.

---

# 25. No Backend in V1

Scope V1 is local-first.

Do not introduce:

* Node backend
* Flask
* Django
* Cloud database
* Authentication system

unless project requirements explicitly change.

Captured debugging information should remain local by default.

---

# 26. No AI in V1

Do not use an LLM to replace engineering that Scope should perform itself.

V1 must implement:

```text
Capture
Normalize
Sanitize
Correlate
Detect
Report
```

using normal deterministic software.

AI may later enhance explanations, but Scope must remain useful without AI.

---

# 27. Testing Philosophy

Core algorithms should be easy to test without launching Chrome.

Especially test:

* Normalization
* Sanitization
* Correlation
* Detection
* Severity calculation
* Report generation

Example:

```text
Given:

Click at 1000ms
POST at 1020ms
500 response at 1400ms
TypeError at 1420ms

Expect:

One correlated incident containing
all four relevant events.
```

Use:

### Vitest

For TypeScript units and core engine behavior.

### React Testing Library

For UI behavior.

### Playwright

For real browser/extension workflows.

Tests should verify behavior, not implementation details.

---

# 28. Documentation

Documentation is part of the implementation.

Important architectural decisions should remain understandable after the conversation with the AI agent ends.

Use comments for **why**, not obvious descriptions of **what**.

Bad:

```ts
// Loop through events
events.forEach(...)
```

Good:

```ts
// Process events chronologically because correlation rules
// depend on temporal proximity between actions and requests.
```

Do not over-comment self-explanatory code.

---

# 29. Task Workflow

For every meaningful implementation task, follow this workflow.

## Step 1 — Understand

Before changing code:

* Inspect the relevant existing files.
* Understand the current data/control flow.
* Identify which Scope layer owns the responsibility.
* Identify dependencies and possible side effects.

Do not immediately edit the first file that appears relevant.

## Step 2 — Explain the Plan

Before implementation, briefly state:

### What we're building

Describe the feature.

### Why Scope needs it

Explain its role in the product.

### Where it belongs

Identify the relevant architecture layer/files.

### How it will work

Explain the expected data/control flow.

Keep this concise for simple tasks and more detailed for architectural tasks.

## Step 3 — Implement

Make the smallest coherent implementation that solves the task properly.

Do not refactor unrelated code unless required.

If unrelated technical debt is discovered, mention it separately instead of silently expanding the task.

## Step 4 — Validate

Run relevant checks.

Depending on the task:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

and relevant integration/E2E tests.

Do not claim something works merely because the code looks correct.

## Step 5 — Explain What Changed

After implementation, provide:

### What we changed

List the meaningful changes.

### How it works

Explain the runtime flow.

Example:

```text
Page
 ↓
Injected network interceptor
 ↓
Content script
 ↓
Runtime message
 ↓
Background worker
 ↓
Normalizer
 ↓
Sanitizer
 ↓
IndexedDB
 ↓
Side Panel
```

### Why we did it this way

Explain the architectural reasoning.

### Important concepts

Teach relevant concepts introduced by the task.

Examples:

* Chrome isolated worlds
* Service worker lifecycle
* IndexedDB transactions
* React state
* TypeScript discriminated unions
* Event correlation

### Files changed

Explain each meaningful file.

Example:

```text
src/content/interactions.ts
Captures relevant user interactions.

src/messaging/messages.ts
Defines typed communication contracts.

src/core/normalization/events.ts
Transforms captured interactions into ScopeEvent objects.
```

### How to test it manually

Give concrete steps.

### What to notice in the code

Point out 1–3 pieces of implementation that are especially important for understanding the architecture.

---

# 30. Teaching Depth

Do not explain basic programming syntax unless requested.

Focus explanations on concepts that matter to understanding Scope.

For example, don't spend time explaining:

```ts
const
```

But do explain why:

```text
Injected script → content script → background worker
```

is necessary.

The goal is software-engineering understanding, not beginner programming tutorials.

---

# 31. When There Are Multiple Solutions

Do not silently choose between substantially different architectural approaches.

Explain briefly:

```text
Option A
Intercept fetch/XHR from page context.

Option B
Use another Chrome API.

Chosen: A

Reason:
...
```

For trivial implementation choices, simply make the appropriate decision.

---

# 32. When the Developer's Request Is Risky

If a requested implementation would:

* Break Scope's architecture
* Introduce security/privacy problems
* Cause substantial performance issues
* Duplicate existing functionality
* Create unnecessary complexity
* Conflict with Manifest V3
* Make future development substantially harder

do not blindly implement it.

Explain the problem and propose a better implementation.

The developer should understand the tradeoff.

---

# 33. Never Fake Completion

Never say a task is complete without verifying what can reasonably be verified.

Distinguish:

```text
Implemented
Tested
Built successfully
Manually verified
Not yet verified
```

If Chrome-specific behavior cannot be verified automatically, say exactly what needs manual testing.

---

# 34. Git Discipline

Keep changes task-focused.

Prefer commits that represent one coherent change.

Example:

```text
feat(capture): add user interaction recording
feat(network): instrument fetch requests
feat(core): add event normalization pipeline
feat(correlation): correlate actions with requests
fix(privacy): redact authorization headers
test(correlation): cover failed request chains
```

Do not mix unrelated formatting/refactoring with feature work.

---

# 35. Development Order

Unless requirements change, Scope should broadly progress through:

```text
1. Extension foundation
2. Side Panel foundation
3. Typed messaging
4. Session lifecycle
5. User interaction capture
6. Network capture
7. Runtime error capture
8. Navigation capture
9. Normalization
10. Privacy sanitization
11. IndexedDB persistence
12. Timeline
13. Correlation engine
14. Detection engine
15. Issues UI
16. Reporting/export
17. Testing/hardening
18. Chrome Web Store preparation
```

Do not jump into advanced AI features before the debugging foundation works.

---

# 36. Definition of Done

A task is not done merely because code was written.

A meaningful task is complete when applicable:

* Implementation is complete
* TypeScript passes
* Lint passes
* Relevant tests pass
* Production build passes
* Privacy implications were considered
* Performance implications were considered
* Existing behavior was not unintentionally broken
* Developer understands what changed and why
* Manual verification instructions are provided when necessary

---

# 37. Final Rule

The AI agent is not here to replace the developer's understanding.

It is here to accelerate development **while increasing that understanding**.

Every completed feature should leave the developer capable of explaining:

> What does this code do?

> Why does Scope need it?

> How does the data move through the system?

> Why did we choose this implementation?

> What could break?

> How do we know it works?

If the feature works but the developer cannot understand or explain it, the task is not fully complete.
