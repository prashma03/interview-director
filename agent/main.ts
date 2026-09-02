import "dotenv/config";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  type JobContext,
  type llm,
} from "@livekit/agents";
import * as tavus from "@livekit/agents-plugin-tavus";
import { RoomEvent } from "@livekit/rtc-node";
import { initialInterviewState, reduceInterview, type InterviewState, type Stage } from "../src/interviewMachine.js";

type TurnHandler = (message: llm.ChatMessage, chatContext: llm.ChatContext) => Promise<void>;
const INTRO_INSTRUCTIONS = "You are the introduction interviewer. Listen warmly. After each answer, give exactly one short, natural acknowledgment. Do not ask a question, score the candidate, or choose the next stage; the deterministic Interview Director owns all questions and transitions.";
const EXPERIENCE_INSTRUCTIONS = "You are the past-experience interviewer. Briefly reflect the candidate's decision or result in one sentence. Do not ask a question, score the candidate, repeat their introduction, or change stages; the deterministic Interview Director owns the workflow.";

class IntroductionAgent extends Agent {
  constructor(private readonly handleTurn: TurnHandler) { super({ id: "introduction-agent", instructions: INTRO_INSTRUCTIONS }); }
  override async onUserTurnCompleted(chatContext: llm.ChatContext, message: llm.ChatMessage) { await this.handleTurn(message, chatContext); }
}
class ExperienceAgent extends Agent {
  constructor(private readonly handleTurn: TurnHandler) { super({ id: "experience-agent", instructions: EXPERIENCE_INSTRUCTIONS }); }
  override async onUserTurnCompleted(chatContext: llm.ChatContext, message: llm.ChatMessage) { await this.handleTurn(message, chatContext); }
}

const transitionSentence = (from: Stage, to: Stage) => from === "introduction" && to === "experience"
  ? "Thank you. I have a clear sense of your direction; now let’s move into one decision story from your past work."
  : to === "debrief" ? "That completes the interview. I’m preparing your evidence map now." : "";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    let state: InterviewState = initialInterviewState;
    let pending: { previousStage: Stage; next: InterviewState } | null = null;
    let flushing = false;
    let interruptions = 0;
    let lastInterruptionAt = 0;
    let interruptedTurn = false;
    let latency: { speechEndedAt?: number; finalTranscriptAt?: number; firstAgentTokenAt?: number; firstAudioAt?: number; speechToTranscriptMs?: number; transcriptToAudioMs?: number; speechToAudioMs?: number } = {};
    const interruptionEvents: Array<{ at: number; kind: "confirmed" | "noise-filtered"; detail: string }> = [];
    let pendingConfirmation: { id: string; stageEpoch: number; originalText: string; resolve: (value: { text: string; edited: boolean } | null) => void } | null = null;
    const session = new AgentSession({
      stt: new inference.STT({ model: process.env.LIVEKIT_STT_MODEL || "deepgram/nova-3", language: "en", fallback: ["assemblyai/universal-streaming"] }),
      llm: new inference.LLM({ model: process.env.LIVEKIT_LLM_MODEL || "openai/gpt-4.1-mini" }),
      tts: new inference.TTS({ model: process.env.LIVEKIT_TTS_MODEL || "cartesia/sonic-3", voice: process.env.LIVEKIT_TTS_VOICE || "Katie", language: "en" }),
      turnHandling: { interruption: { enabled: true, minDuration: 0.6, minWords: 2 }, turnDetection: new inference.TurnDetector() },
    });

    const publish = async (message: unknown) => {
      if (!ctx.room.localParticipant) return;
      await ctx.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(message)), { reliable: true, topic: "interview.state" });
    };
    const publishState = () => publish({ type: "director-state", state });
    const publishTelemetry = () => publish({ type: "telemetry", telemetry: { agent: session.agentState, candidate: session.userState, interruptions, interruptionEvents: interruptionEvents.slice(-8), latency, firstTokenMeasurement: "unavailable-with-current-pipeline-events" } });

    const activateStage = (stage: Stage) => {
      if (stage === "introduction") session.updateAgent(new IntroductionAgent(handleTurn));
      if (stage === "experience") session.updateAgent(new ExperienceAgent(handleTurn));
    };
    const flushPending = async () => {
      if (flushing || !pending) return;
      flushing = true;
      const work = pending; pending = null;
      try {
        await session.interrupt({ force: true });
        if (work.previousStage !== work.next.stage) activateStage(work.next.stage);
        const bridge = transitionSentence(work.previousStage, work.next.stage);
        if (bridge) await session.say(bridge, { allowInterruptions: false }).waitForPlayout();
        if (work.next.stage === "introduction" || work.next.stage === "experience") session.say(work.next.currentPrompt, { allowInterruptions: true });
      } finally { flushing = false; if (pending) void flushPending(); }
    };
    async function handleTurn(message: llm.ChatMessage, chatContext: llm.ChatContext) {
      const text = message.textContent?.trim();
      if (!text || (state.stage !== "introduction" && state.stage !== "experience")) return;
      if (pendingConfirmation) return;
      const turnEpoch = state.stageEpoch;
      const confirmed = await new Promise<{ text: string; edited: boolean } | null>((resolve) => {
        pendingConfirmation = { id: message.id, stageEpoch: turnEpoch, originalText: text, resolve };
        void publish({ type: "transcript-final", id: message.id, text, stageEpoch: turnEpoch });
      });
      pendingConfirmation = null;
      if (!confirmed || state.stageEpoch !== turnEpoch) return;
      chatContext.addMessage({ role: "developer", content: interruptedTurn ? "The candidate spoke over the prior response. Acknowledge naturally with no apology or restart, then give one brief reflection only. Do not ask a question." : "Reply with one brief acknowledgment only. Do not ask the next question." });
      interruptedTurn = false;
      const previousStage = state.stage;
      const next = reduceInterview(state, { type: "ANSWER", now: performance.now(), timestamp: Date.now(), eventId: message.id, stageEpoch: state.stageEpoch, text: confirmed.text, transcriptEdited: confirmed.edited });
      if (next === state) return;
      state = next; pending = { previousStage, next };
      await publishState();
    }

    session.on(AgentSessionEventTypes.AgentStateChanged, (event) => {
      if (event.newState === "speaking" && latency.speechEndedAt !== undefined && latency.firstAudioAt === undefined) {
        const at = Date.now();
        latency = { ...latency, firstAudioAt: at, speechToAudioMs: at - latency.speechEndedAt, transcriptToAudioMs: latency.finalTranscriptAt === undefined ? undefined : at - latency.finalTranscriptAt };
      }
      void publishTelemetry();
    });
    session.on(AgentSessionEventTypes.UserStateChanged, (event) => {
      if (event.oldState === "speaking" && event.newState === "listening") latency = { speechEndedAt: Date.now() };
      void publishTelemetry();
    });
    session.on(AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (!event.isFinal) return;
      const at = Date.now();
      latency = { ...latency, finalTranscriptAt: at, speechToTranscriptMs: latency.speechEndedAt === undefined ? undefined : at - latency.speechEndedAt };
      void publishTelemetry();
    });
    session.on(AgentSessionEventTypes.OverlappingSpeech, (event) => {
      const at = Date.now();
      if (event.isInterruption && at - lastInterruptionAt >= 1500) {
        lastInterruptionAt = at; interruptions += 1; interruptedTurn = true;
        interruptionEvents.push({ at, kind: "confirmed", detail: `Candidate interrupted after ${event.totalDurationInS.toFixed(1)}s overlap; interviewer output was yielded.` });
      } else if (!event.isInterruption) interruptionEvents.push({ at, kind: "noise-filtered", detail: "Brief overlap was treated as a backchannel/noise and did not restart the turn." });
      void publishTelemetry();
    });
    session.on(AgentSessionEventTypes.AgentFalseInterruption, (event) => {
      interruptionEvents.push({ at: event.createdAt, kind: "noise-filtered", detail: event.resumed ? "False interruption detected; remaining speech resumed." : "False interruption detected; no full response was restarted." });
      void publishTelemetry();
    });
    session.on(AgentSessionEventTypes.ConversationItemAdded, (event) => { if (event.item.type === "message" && event.item.role === "assistant") void flushPending(); });
    session.on(AgentSessionEventTypes.Error, (event) => { void publish({ type: "agent-error", error: String(event.error) }); });
    ctx.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (topic !== "interview.command") return;
      try {
        const command = JSON.parse(new TextDecoder().decode(payload));
        const confirmation = pendingConfirmation;
        if (command.type === "confirm-transcript" && confirmation && confirmation.id === command.id && confirmation.stageEpoch === command.stageEpoch) {
          const clean = String(command.text || "").trim().slice(0, 12_000);
          if (clean) confirmation.resolve({ text: clean, edited: clean !== confirmation.originalText });
          return;
        }
        if (command.type === "repeat-question" && (state.stage === "introduction" || state.stage === "experience")) {
          void (async () => { await session.interrupt({ force: true }); session.say(state.currentPrompt, { allowInterruptions: true }); })();
        }
      } catch { /* Ignore malformed candidate commands. */ }
    });

    const introAgent = new IntroductionAgent(handleTurn);
    let avatar: tavus.AvatarSession | null = null;
    let avatarStarted = false;
    if (process.env.TAVUS_API_KEY) {
      try {
        await publish({ type: "avatar-status", status: "loading" });
        avatar = new tavus.AvatarSession({ faceId: process.env.TAVUS_FACE_ID || process.env.TAVUS_REPLICA_ID, palId: process.env.TAVUS_PAL_ID || process.env.TAVUS_PERSONA_ID });
        await avatar.start(session, ctx.room);
        avatarStarted = true;
        await publish({ type: "avatar-status", status: "connected", conversationId: avatar.conversationId });
      } catch (error) {
        avatar = null;
        await publish({ type: "avatar-status", status: "error", error: error instanceof Error ? error.message : "Tavus avatar unavailable." });
      }
    } else await publish({ type: "avatar-status", status: "unavailable" });
    await session.start({ agent: introAgent, room: ctx.room, outputOptions: { audioEnabled: !avatarStarted, transcriptionEnabled: true } });
    state = reduceInterview(state, { type: "START", now: performance.now(), timestamp: Date.now(), eventId: "session-start", stageEpoch: state.stageEpoch });
    await publishState();
    session.say(state.currentPrompt, { allowInterruptions: true });

    const timer = setInterval(() => {
      const previousStage = state.stage;
      const next = reduceInterview(state, { type: "TICK", now: performance.now(), timestamp: Date.now(), eventId: `timer-${Math.floor(performance.now() / 1000)}`, stageEpoch: state.stageEpoch });
      if (next !== state) { state = next; pending = { previousStage, next }; void publishState(); void flushPending(); }
    }, 1000);
    ctx.addShutdownCallback(async () => { clearInterval(timer); pendingConfirmation?.resolve(null); state = reduceInterview(state, { type: "DISCONNECT", now: performance.now(), timestamp: Date.now(), eventId: "shutdown", stageEpoch: state.stageEpoch }); await publishState(); await avatar?.aclose(); await session.close(); });
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url) }));
