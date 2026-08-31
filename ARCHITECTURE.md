# Architecture

## Product boundary

Interview Director is one application with three deliberately separate layers:

1. **Director** — owns the finite interview workflow and its invariants.
2. **Voice room** — LiveKit transports audio and supplies turn/interruption events.
3. **Presence** — Tavus renders the interviewer; it never decides workflow state.

Keeping the Director independent prevents a model or avatar failure from trapping the candidate in one stage.

## State transition contract

| From | To | Normal trigger | Fallback |
|---|---|---|---|
| Briefing | Introduction | candidate starts | none |
| Introduction | Experience | introduction is complete | 2 turns or 150 seconds |
| Experience | Debrief | required evidence collected | primary-question/follow-up cap or 300 seconds |

Every transition records its timestamp and reason. The UI can therefore demonstrate that the fallback requirement is real rather than prompt text.

## Evidence-driven questioning

The demo-mode Director uses deterministic signal extraction so its behavior can be tested without provider credentials. A production LLM adapter should return the same schema rather than controlling the workflow directly.

```text
answer → extract covered signals → find highest-value gap
                                  ├─ no important gap → next primary question
                                  ├─ fewer than 2 follow-ups → targeted follow-up + reason
                                  └─ cap reached → record gap + move forward
```

The required experience evidence is context, ownership, reasoning, and impact. Difficulty and reflection improve the evaluation but do not trap the candidate in the stage. The debrief only marks signals actually found in candidate answers.

## Live flow

```text
Browser ──POST /api/session──> API ──signed JWT──> Browser
   │                                                │
   └──────────── WebRTC / audio ───────────────> LiveKit room
                                                    │
                                          LiveKit agent worker
                                                    │
                                          Director state machine

Browser ──POST /api/avatar/conversation──> API ──> Tavus
```

## Security choices

- LiveKit and Tavus credentials remain server-side.
- Session tokens expire after 15 minutes and grant access to one random room.
- Tavus recording is disabled by default.
- Candidate strings are length-limited before reaching provider APIs.
- A production build should add authentication, rate limiting, consent, retention controls, and provider webhook verification.

## Next adapter work

The current demo exercises the Director locally. The LiveKit worker should map final transcripts to `ANSWER`, a monotonic timer to `TICK`, and an explicit close action to `END`. During a handoff it should pass a schema-validated summary of the candidate's evidence, not the entire raw transcript.
