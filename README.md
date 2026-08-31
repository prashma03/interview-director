# Interview Director

Interview Director is a two-stage AI interview prototype built around an explicit, auditable state machine. It is intentionally usable without credentials in demo mode; LiveKit and Tavus adapters are the next integration layer.

## Why it is different

- It interviews for evidence and decision-making rather than generic confidence.
- Stage transitions are deterministic and visibly report their reason.
- Candidate answers persist across the introduction → experience handoff.
- The UI exposes latency, interruptions, handoffs, and captured evidence.
- The debrief is designed to cite the candidate's own answers rather than inventing feedback.
- Each answer is mapped to employer-relevant signals: identity, strengths, direction, role connection, context, ownership, reasoning, difficulty, impact, and reflection.
- Follow-ups are adaptive (zero when evidence is complete, otherwise a maximum of two per primary question).
- Candidate timing uses gentle language after long answers; only stage fallbacks are deterministic timers.

## Interview policy

- Introduction: two primary questions, up to two evidence-driven follow-ups each, 150-second stage fallback.
- Past experience: three primary questions, up to two evidence-driven follow-ups each, 300-second stage fallback.
- No visible per-question countdown and no penalty for answer duration.
- At 2½ minutes, the Director records a soft redirect and narrows the next prompt at a natural boundary.
- Every follow-up records the missing evidence and every handoff records its trigger.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env` and run `npm run server` in a second terminal to enable the provider session API. Without credentials, the UI remains usable in deterministic demo mode.

Run the state-machine tests with `npm test` and create a production bundle with `npm run build`.

## Architecture boundary

`src/interviewMachine.ts` is provider-independent. A production adapter will translate LiveKit session events into its `START`, `ANSWER`, `TICK`, and `END` signals. Tavus remains the video/avatar surface; it does not own stage transitions.

## Integration roadmap

1. Add a server-side LiveKit token endpoint.
2. Add `IntroductionAgent` and `ExperienceAgent` with shared structured state.
3. Stream transcription and interruption events into the UI.
4. Start a Tavus conversation after the LiveKit room is ready.
5. Replace heuristic evidence scoring with a schema-validated, citation-based evaluator.

Never expose provider API secrets in the Vite client.
