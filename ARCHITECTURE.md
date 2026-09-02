# Architecture

## Runtime components

| Component | Implementation | Authority |
|---|---|---|
| Web client | React, Vite, `livekit-client` | UI, microphone permission, transcript confirmation |
| Session API | Express, `livekit-server-sdk` | Short-lived room tokens and optional standalone Tavus CVI lifecycle |
| Agent worker | LiveKit Agents for Node.js | STT/LLM/TTS orchestration and room lifecycle |
| Interview Director | `src/interviewMachine.ts` | Sole owner of stages, questions, evidence, limits, and transitions |
| Avatar | Official LiveKit Tavus plugin | Lip-synced video/audio rendering only |

The LLM never mutates workflow state. `IntroductionAgent` and `ExperienceAgent` differ only in conversational instructions. Both send final, candidate-confirmed answers into the same provider-independent Director.

## State and evidence flow

```text
briefing → introduction → experience → debrief → ended
                 │              │
                 └──── shared confirmed evidence ────┘
```

Introduction collects identity/background, strengths, direction, and role connection. Experience collects context, ownership, reasoning, difficulty, impact, and reflection. Deterministic extraction maps confirmed text to this schema. A follow-up targets the highest-priority missing signal and is recorded so the same gap is not asked twice for one primary question.

Normal stage completion requires the configured primary questions and required evidence. Fallbacks are 150 seconds or six turns for introduction and 300 seconds or nine turns for experience. Timers use monotonic process time. Every transition stores from/to stages, wall-clock timestamp, trigger, epoch, machine reason, and a human-readable explanation.

Event IDs reject duplicate delivery. Stage epochs reject late answers from a previous agent. `ended` is terminal, so late timers and provider events cannot reopen the interview.

## Real-time data flow

```text
Browser ── POST /api/session ──> Express API
Browser <── 15-minute room JWT ─ Express API
Browser ═════ WebRTC microphone/data/audio/video ═════ LiveKit room
                                                        │
                                              LiveKit AgentSession
                                                        │
                           streaming STT → confirmed-text gate → Director
                                                        │
                                    stage-specific LLM acknowledgment
                                                        │
                                              low-latency TTS text/audio
                                                        │
                                            Tavus echo PAL + Face
                                                        │
Browser <══════════ Tavus participant audio/video ══════╝
```

Final STT produces a reliable `transcript-final` data message. The worker waits while the browser lets the candidate edit or confirm it. Only `confirm-transcript` produces an `ANSWER` event. Interim STT never enters evidence. If the stage epoch changes while confirmation is open, the stale confirmation is discarded.

Director state, agent/user speaking state, avatar status, interruptions, provider errors, and latency marks are published on the `interview.state` topic. Candidate commands use `interview.command`.

## Audio ownership and interruption

When Tavus starts successfully, direct LiveKit agent audio is disabled. LiveKit TTS feeds the Tavus echo pipeline, and Tavus publishes the only audible interviewer track plus synchronized video. This avoids duplicate TTS. If Tavus is absent or fails before session start, the worker reports `unavailable`/`error` and enables direct agent TTS audio; the UI never labels the decorative placeholder as connected.

LiveKit interruption handling requires at least 600 ms and two words. Confirmed interruption diagnostics have a 1.5-second cooldown; short backchannels/noise are reported separately. Pending interviewer speech is yielded, completed transcript/evidence is preserved, and the next acknowledgment is short rather than replaying the full interrupted response.

## Latency observations

- Candidate speech end: worker user-state transition from speaking to listening.
- Final transcript: LiveKit final STT event.
- Server output start: agent state becomes speaking.
- Received audio: browser observes a remote LiveKit active-speaker event.
- First LLM token: explicitly unavailable because the installed pipeline exposes no trustworthy callback.

The UI reports measurements as observations, not guarantees. Candidate confirmation time is intentionally included in end-to-audio latency because it delays the next response by product design.

## Tavus lifecycle paths

The production interview uses `AvatarSession`, which creates and closes a Tavus conversation tied to the LiveKit room using `TAVUS_PERSONA_ID`/`TAVUS_REPLICA_ID` aliases or the newer PAL/Face IDs.

The API additionally provides `POST /api/tavus/conversations` and `POST /api/tavus/conversations/:conversationId/end` for standalone Persona/Replica CVI lifecycle coverage. Recording is disabled, rooms require authentication, abandoned conversations are ended after 15 minutes, and termination is idempotent. The normal interview never starts this standalone path alongside the plugin because that would create two rooms and competing audio pipelines.

## Security and reliability boundary

Secrets remain in API/worker environments. The API validates strict request schemas and lengths, caps JSON bodies, restricts CORS, and issues one-room tokens. Worker shutdown closes confirmation waits, Tavus, and AgentSession resources.

Prototype limitations remain: no application authentication, distributed rate limiting or idempotency store, persistent encrypted transcript store, webhook verification, formal consent flow, provider cost enforcement, or multi-region failover. These must be added before handling real applicants at scale.
