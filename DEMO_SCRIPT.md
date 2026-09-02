# Submission video script

Use real provider mode for the recorded challenge demonstration. Before recording, complete the checklist at the end and close any window that exposes `.env` values.

## 1. Connection and microphone — 20 seconds

Show the three terminals running the API, worker, and web client without revealing secrets. Open the site and point to **REAL PROVIDER MODE**, LiveKit status, Tavus status, and microphone state. Click **Start live interview**, grant microphone permission, and wait for both LiveKit and Tavus to show connected.

Say: “The browser receives a short-lived room token from my server. Provider keys never enter the frontend.”

## 2. Real Tavus avatar — 15 seconds

Show the Tavus video track and let the opening prompt play. Point out the persistent caption. Briefly explain that direct agent audio is disabled when Tavus is active, so the candidate hears one lip-synced stream rather than duplicate TTS.

## 3. Self-introduction — 35 seconds

Answer the first introduction prompt with identity and strengths. When the final transcript dialog appears, correct one harmless term and confirm it. Point to the confirmed/corrected transcript in diagnostics. Answer the second primary with career direction and a specific connection to the AI Engineer role.

## 4. Normal stage transition — 15 seconds

Show the stage rail move from introduction to experience. Point out the one-time transition sentence, transition reason, and preserved introduction evidence. Explain that the Director—not the LLM—owns this transition.

## 5. Candidate interruption — 25 seconds

While the interviewer is speaking, begin a meaningful sentence and continue for more than two words. Show that interviewer audio yields and no full response restarts. Point to the confirmed interruption entry. Optionally make a very short sound/backchannel and show it classified as filtered noise rather than another unstable interruption.

## 6. Past-experience questioning — 45 seconds

Answer using context, personal ownership, the alternative rejected, reasoning, difficulty, measurable impact, and reflection. If a required signal is missing, show that the next follow-up names that missing evidence instead of repeating a generic question. Confirm each final transcript.

## 7. Evidence persistence — 15 seconds

Point to introduction and experience entries together in confirmed transcript history/evidence coverage. Expand an evidence receipt and show whether it was corrected. Emphasize that corrections are transparent and never negative evidence.

## 8. Time fallback — 20 seconds

For a short recording, demonstrate the fallback with an automated test rather than waiting five minutes. Show the tests for the 150-second introduction and 300-second experience fallback and the transition audit assertion. If a live fallback is required, temporarily use documented development-only limits, record it, then revert them before submission.

## 9. Debrief — 25 seconds

Complete the interview and show the evidence map, missing signals, transition reason, confirmed answer receipts, integrity disclosure, and human-review recourse. End the session and show the clean terminal state.

## 10. Tests and measured latency — 25 seconds

Show `npm test` with all tests passing and `npm run build` succeeding. Point to measured speech-to-transcript, server-speaking, and browser-received-audio values. State explicitly: “First-token timing is unavailable from this pipeline, so the UI does not fabricate it.”

## Closing — 10 seconds

“This is a real voice and avatar integration around an auditable interview workflow. LiveKit transports and orchestrates the call, Tavus renders the interviewer, and a deterministic Director owns stages, evidence, limits, and recovery.”

## Pre-recording checklist

- LiveKit URL, key, and secret are configured server-side.
- LiveKit Inference has access to the configured STT, LLM, and TTS models.
- Tavus API key, Persona ID, and Replica ID are valid; or PAL/Face aliases are configured for LiveKit echo transport.
- API health reports LiveKit and Tavus configured.
- API, worker, and Vite client are running.
- Browser microphone permission is allowed and output audio is audible.
- The badge says `TAVUS · CONNECTED`; do not record the decorative placeholder as a real avatar.
- A short live rehearsal verified speech, lip-sync, confirmation, interruption, and cleanup.
- `.env`, provider consoles, keys, tokens, and personal browser tabs are not visible.
- `npm test` and `npm run build` pass immediately before recording.
