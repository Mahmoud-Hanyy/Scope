# Scope incident: HTTP 503 · GET /[REDACTED]

Severity: MEDIUM
Medium: a runtime failure was also observed in this proposed group. The timing-based relationship and user impact remain uncertain.

Session: 7b367538-5101-4d10-8a61-92fd6f66ee41
Incident: e3aee774-ab7c-4e41-a92b-988159a8cb06
Analysis snapshot: 3 captured events; session stopped.
Session ended by: user.

## Observed sequence

1. +0.263s — Fetch GET · same-origin /[REDACTED] · #3e3d6336 [event b4c07ae0-bc2d-4c40-b599-9acd7344123e]
2. +0.267s — Fetch GET → HTTP 503 · 4.3 ms · same-origin /[REDACTED] · #3e3d6336 [event e3aee774-ab7c-4e41-a92b-988159a8cb06]
3. +0.629s — Uncaught exception · Error · same-origin /[REDACTED]/[REDACTED]:9:58621 · message and stack omitted [event c7408f54-4dfb-4f79-ab5a-0fb960f02a30]

## Relationship evidence

- Event 1 → 2: Exact pairing: matching request ID, transport, method, endpoint, session, tab, and document.
- Event 2 → 3: Possible relationship: runtime error followed this failure by 362.4 ms; it was the only failed response in the preceding 1,000 ms in this document, with no captured interaction in between. Timing does not prove causation.

## Limits and privacy

- Temporal links are hypotheses, not proof of root cause. Page-context metadata is not authenticated evidence.
- Messages, stacks, rejection values, form values, page text, headers, bodies, actual origins, query strings, and private path segments are omitted.
- Capture covers the top document during recording. Navigation, teardown, and storage limits can leave gaps. Pending requests may lack a completion.
- Fetch timing generally ends at response headers; XHR timing ends at its terminal event.
