# Interview Director — Jobnova Part 1

A deployable real-time mock interview built with a deterministic interview director, LiveKit Agents, and a Tavus PAL/Face avatar. It retains a credential-free browser demo for reviewing the workflow.

## Implemented

- LiveKit room connection, short-lived server-generated tokens, microphone controls, reconnect handling, and cleanup.
- Official LiveKit Agents streaming STT → LLM → TTS pipeline with turn detection and interruptions.
- Tavus LiveKit avatar output: the PAL publishes synchronized video and speech in the same room. Without Tavus, the agent publishes TTS audio directly.
- Separate `IntroductionAgent` and `ExperienceAgent`; neither selects stages or asks uncontrolled questions.
- Authoritative `briefing → introduction → experience → debrief → ended` state machine.
- Two introduction and three experience primary questions, with at most two targeted follow-ups per primary.
- Monotonic 150-second and 300-second stage fallbacks.
- Event IDs and stage epochs reject duplicates, repeated transitions, and old-stage responses.
- Persistent evidence, transition audit records, captions, repeat-question command, and speech telemetry.
- Candidate-confirmed live transcripts: interim STT is ignored and the agent waits for confirmation or edits before evidence extraction.
- Debounced interruption handling with confirmed-interruption and filtered-noise diagnostics.

## Architecture

One `AgentSession` minimizes handoff latency. Stage agents provide different instructions, while `src/interviewMachine.ts` alone owns questions and transitions. During a handoff, the worker interrupts old output, swaps agents once, speaks one bridge, and delivers one prompt. Evidence remains in shared director state.

Tavus uses the official LiveKit Agents plugin instead of a second Daily conversation. Candidate audio, agent speech, the lip-synced avatar, and cleanup therefore share one LiveKit room.

The worker's Tavus avatar is the only audible interviewer output when connected: LiveKit TTS is streamed into Tavus for rendering and the browser subscribes to Tavus audio/video. Direct agent audio is disabled, preventing duplicate TTS. If Tavus fails, the worker clearly reports it and falls back to direct LiveKit TTS without presenting the decorative placeholder as connected.

For take-home API coverage, the server also exposes `POST /api/tavus/conversations` and `POST /api/tavus/conversations/:conversationId/end` using the official Persona/Replica CVI endpoints. Those endpoints keep the API key server-side, require private rooms, and disable recording. They are a standalone CVI lifecycle surface; the normal LiveKit interview deliberately uses the LiveKit Tavus plugin so two independent conversations and two audio pipelines are never started together.

Interruption detection requires at least 600 ms and two words, and confirmed events have a 1.5-second diagnostic cooldown. LiveKit yields current speech; brief backchannels/noise are logged separately, and the next acknowledgment is short instead of restarting the interrupted response.

## Local setup

Requires Node.js 24+, LiveKit Cloud, and a Tavus API key with a Face and PAL configured for LiveKit transport and `echo` pipeline mode.

```bash
npm install
copy .env.example .env
```

Fill in `.env`; only `VITE_API_URL` is browser-visible. Run three terminals:

```bash
npm run server
npm run agent:dev
npm run dev
```

Open `http://localhost:5173`, allow microphone access, and choose **Start live interview**. Use **Credential-free demo** without provider credentials. LiveKit Inference must have access to the configured models.

### Required environment variables

| Variable | Used by | Required |
|---|---|---|
| `LIVEKIT_URL` | API and worker | Yes, real mode |
| `LIVEKIT_API_KEY` | API and worker | Yes, real mode |
| `LIVEKIT_API_SECRET` | API and worker | Yes, real mode |
| `TAVUS_API_KEY` | Worker/API | Yes, real avatar |
| `TAVUS_PERSONA_ID` | Worker/API | Yes for Persona/Replica configuration |
| `TAVUS_REPLICA_ID` | Worker/API | Yes for Persona/Replica configuration |
| `TAVUS_PAL_ID` | Worker | Optional newer alias for Persona |
| `TAVUS_FACE_ID` | Worker | Optional newer alias for Replica |
| `LIVEKIT_STT_MODEL` | Worker | Optional; defaults to `deepgram/nova-3` |
| `LIVEKIT_LLM_MODEL` | Worker | Optional; defaults to `openai/gpt-4.1-mini` |
| `LIVEKIT_TTS_MODEL` | Worker | Optional; defaults to `cartesia/sonic-3` |
| `LIVEKIT_TTS_VOICE` | Worker | Optional; defaults to `Katie` |
| `APP_ORIGIN` | API | Yes in deployment; comma-separated allowed origins |
| `VITE_API_URL` | Browser build | Yes outside localhost; not a secret |
| `PORT` | API | Optional; defaults to `8787` |

### LiveKit configuration

1. Create a LiveKit Cloud project and copy its WebSocket URL, API key, and secret into `.env`.
2. Enable LiveKit Inference/model access for the selected STT, LLM, and TTS providers, or replace the model environment values with models available to the project.
3. Start `npm run server`; `GET http://localhost:8787/api/health` should report `livekit: true`.
4. Start `npm run agent:dev` and confirm the worker registers without authentication or model errors.
5. Do not put the LiveKit secret in a `VITE_` variable. The browser receives only a scoped 15-minute room JWT.

### Tavus configuration

1. Create or choose a Tavus Persona and Replica and copy their IDs to `TAVUS_PERSONA_ID` and `TAVUS_REPLICA_ID`.
2. For the official LiveKit plugin, the current Tavus naming is PAL and Face. Either let the worker use the Persona/Replica aliases or set `TAVUS_PAL_ID` and `TAVUS_FACE_ID` explicitly.
3. A custom PAL must use `pipeline_mode: echo` with a LiveKit transport. Echo mode lets LiveKit own the conversational model while Tavus owns lip-synced rendering.
4. Start a real interview and require the UI to show `TAVUS · CONNECTED`. `UNAVAILABLE`, `LOADING`, or `ERROR` is not a successful avatar test.
5. Recording is disabled for the standalone CVI endpoint. Review the Tavus account settings and consent requirements before using any real applicant data.

## Verify

```bash
npm test
npm run build
```

Tests cover evidence extraction, follow-up limits, fallbacks, event deduplication, stale-stage rejection, transition audits, and terminal timer safety.

## Deploy

- Build the frontend and deploy `dist/` to a static host. Set `VITE_API_URL` at build time.
- Deploy `Dockerfile.api` as an HTTPS web service with LiveKit credentials and `APP_ORIGIN`.
- Deploy `Dockerfile.agent` as an always-on worker with LiveKit, model, and Tavus variables.
- GitHub Actions verifies tests and builds.

GitHub Pages can host only the frontend; it cannot run the token API or persistent agent worker. Use a container host for those services.

### Concrete deployment order

1. Deploy `Dockerfile.api`; configure provider secrets, `APP_ORIGIN`, and HTTPS. Verify `/api/health`.
2. Deploy `Dockerfile.agent` as an always-on background service using the same LiveKit project and Tavus/model variables.
3. Build the frontend with `VITE_API_URL=https://your-api.example.com npm run build` and deploy `dist/`.
4. Update `APP_ORIGIN` to the exact frontend origin and redeploy the API.
5. Run a credentialed smoke interview: connect, confirm mic, see real Tavus video, interrupt once, transition stages, end, and confirm cleanup.
6. Keep GitHub Actions required on the deployment branch so tests and both builds must pass.

## Security and limitations

- Provider secrets never enter the frontend. Room tokens expire after 15 minutes.
- Tab visibility, focus loss, and paste events are disclosed context, not proof. Browsers cannot reveal another tab's URL or identify ChatGPT.
- Both demo and live mode require transcript confirmation. Live mode intentionally pauses after final STT; this improves candidate control but adds confirmation time to response latency.
- Provider availability, quotas, and Tavus asset configuration require real account credentials.

The API validates request shapes and lengths, restricts CORS to `APP_ORIGIN` (comma-separated origins are supported), removes the Express signature header, keeps secrets server-side, and caps JSON bodies. LiveKit tokens expire after 15 minutes. Standalone Tavus conversations receive a 15-minute abandoned-session cleanup timer, and the termination endpoint is idempotent. The LiveKit worker also closes Tavus and agent resources when the participant leaves.

Before production use, add application authentication and authorization, explicit recording/biometric consent, a documented transcript retention/deletion policy, persistent distributed session/idempotency storage, rate limiting, Tavus webhook signature verification, structured redacted logging, abuse controls, regional/privacy review, alerting, and provider-budget limits. Current in-memory cleanup state is appropriate for a single prototype process, not horizontally scaled deployment. LiveKit inference, STT/LLM/TTS, egress, and Tavus usage all create provider costs that should be metered.

Latency diagnostics report observed timestamps rather than claiming zero latency. The browser uses LiveKit's received active-speaker signal as the closest available first-audible-audio observation; server agent-speaking time is shown separately. The installed pipeline does not expose a trustworthy first-token callback, so that field is explicitly displayed as unavailable.

## Troubleshooting

| Symptom | Check |
|---|---|
| “LiveKit credentials are not configured” | Confirm all three `LIVEKIT_*` credentials are in the `.env` used by the API process, then restart it. |
| Browser CORS error | Set `APP_ORIGIN` to the exact browser origin, including scheme and port. |
| Worker never joins | Confirm it uses the same LiveKit project and that `npm run agent:dev` remains running. |
| Microphone unavailable | Use HTTPS or localhost, grant browser permission, select the correct input, and reload after changing permission. |
| Tavus stays `LOADING` | Verify API key and IDs, PAL echo mode/LiveKit transport, Tavus concurrency quota, and worker logs. |
| Tavus says `ERROR` but voice works | The worker has truthfully fallen back to direct LiveKit TTS. Fix Tavus before recording the avatar requirement. |
| Duplicate or silent audio | Confirm only the plugin path is running; do not also open the standalone Tavus conversation URL. Check browser autoplay permission. |
| Transcript dialog never appears | Check worker STT/model access and the browser data-channel connection. Only final STT opens confirmation. |
| Old answer is ignored | A timer/stage handoff occurred before confirmation. This is intentional stale-epoch protection; answer the current prompt. |
| Tests/build show `spawn EPERM` on Windows | Run the terminal normally outside a restricted sandbox; Vite/Vitest must spawn a helper process. |

## Demo checklist

- Use **Start live interview**, never the local demo button, for the submission video.
- Verify `REAL PROVIDER MODE`, LiveKit connected, Tavus connected, and microphone enabled.
- Show a real Tavus video track speaking the persistent opening caption.
- Confirm/edit an introduction transcript and complete the normal handoff.
- Interrupt the interviewer and show the diagnostic event.
- Complete experience evidence and show it persisted with introduction evidence.
- Demonstrate timed fallbacks through the automated tests to avoid a five-minute recording pause.
- Show the debrief, transition reason, confirmed transcript receipts, and measured latency.
- End the room and show clean terminal state.
- Run `npm test` and `npm run build` on camera without exposing secrets.

## Completion status

| Requirement | Status |
|---|---|
| Deterministic stages, limits, fallbacks, evidence and handoff | Implemented and locally tested |
| LiveKit token API, browser room, mic, worker, STT/LLM/TTS | Implemented; requires credentialed manual verification |
| Tavus Persona/Replica lifecycle and LiveKit lip-synced avatar | Implemented; requires credentialed manual verification |
| Interruption handling and diagnostics | Implemented and unit-tested; real acoustic behavior requires manual verification |
| Final transcript confirmation/editing | Implemented and unit-tested |
| Reconnection, errors, termination and abandoned cleanup | Implemented; provider failure modes require manual verification |
| UI diagnostics and honest latency observations | Implemented; values populate only in a real room |
| Unit/CI/build/deployment configuration | Implemented and locally verified |

This repository is code-complete for the prototype, but the challenge must not be called fully verified until a real credentialed run confirms voice interaction, normal stage handoff, acoustic interruption behavior, Tavus video/lip-sync, and cleanup.

## Official references

- [LiveKit Agents](https://docs.livekit.io/agents/)
- [Agent sessions](https://docs.livekit.io/agents/logic/sessions/)
- [Voice pipelines](https://docs.livekit.io/agents/models/pipelines/)
- [Tavus plugin](https://docs.livekit.io/agents/models/avatar/plugins/tavus/)
- [Node starter](https://github.com/livekit-examples/agent-starter-node)
