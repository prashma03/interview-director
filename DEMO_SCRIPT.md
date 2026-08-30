# Interview Director — demo script

## Opening (20 seconds)

“Most mock interview tools ask a list of generic questions. Interview Director behaves more like a careful human interviewer: it follows evidence, preserves context across stages, and exposes the reason for every transition.”

## Required workflow (2–3 minutes)

1. Show the briefing and explain the two-stage rail.
2. Begin the interview and answer the introduction prompt.
3. Point out the evidence appearing in the right rail.
4. Demonstrate the normal handoff into the decision-story stage.
5. Interrupt a deliberately longer interviewer response and show that speech yields.
6. Complete the three experience prompts.
7. Show the debrief and transition reason.

## Reliability proof (45 seconds)

Open the test output and explain that stage progression is not merely an LLM instruction. Show the tests for semantic completion, turn-limit fallback, timed fallback, and evidence preservation.

## Architecture (45 seconds)

Explain that LiveKit owns real-time transport, the Director owns workflow state, and Tavus owns visual presence. Call out short-lived room tokens, server-side secrets, and recording being disabled by default.

## Closing

“The result is not just an avatar that asks questions; it is an observable interview workflow that can explain what it heard, why it followed up, and why it moved on.”
