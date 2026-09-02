export interface LatencyMarks {
  speechEndedAt?: number;
  finalTranscriptAt?: number;
  firstAgentTokenAt?: number;
  firstAudioAt?: number;
  speechToTranscriptMs?: number;
  transcriptToAudioMs?: number;
  speechToAudioMs?: number;
}

export interface PendingConfirmation { id: string; originalText: string; stageEpoch: number }
export interface RealtimeProtocolState {
  pending: PendingConfirmation | null;
  confirmed: Array<{ id: string; text: string; edited: boolean }>;
  interruptions: number;
  filteredInterruptions: number;
  lastInterruptionAt?: number;
  latency: LatencyMarks;
  ended: boolean;
}

export type ProtocolEvent =
  | { type: "SPEECH_ENDED"; at: number }
  | { type: "FINAL_TRANSCRIPT"; at: number; id: string; text: string; stageEpoch: number }
  | { type: "CONFIRM"; id: string; text: string; stageEpoch: number }
  | { type: "FIRST_TOKEN"; at: number }
  | { type: "FIRST_AUDIO"; at: number }
  | { type: "INTERRUPTION"; at: number; confirmed: boolean; cooldownMs?: number }
  | { type: "END" };

export const initialRealtimeProtocolState: RealtimeProtocolState = { pending: null, confirmed: [], interruptions: 0, filteredInterruptions: 0, latency: {}, ended: false };

export function reduceRealtimeProtocol(state: RealtimeProtocolState, event: ProtocolEvent): RealtimeProtocolState {
  if (state.ended) return state;
  if (event.type === "SPEECH_ENDED") return { ...state, latency: { speechEndedAt: event.at } };
  if (event.type === "FINAL_TRANSCRIPT") {
    const speechEndedAt = state.latency.speechEndedAt;
    return { ...state, pending: { id: event.id, originalText: event.text, stageEpoch: event.stageEpoch }, latency: { ...state.latency, finalTranscriptAt: event.at, speechToTranscriptMs: speechEndedAt === undefined ? undefined : Math.max(0, event.at - speechEndedAt) } };
  }
  if (event.type === "CONFIRM") {
    if (!state.pending || state.pending.id !== event.id || state.pending.stageEpoch !== event.stageEpoch || !event.text.trim()) return state;
    return { ...state, pending: null, confirmed: [...state.confirmed, { id: event.id, text: event.text.trim(), edited: event.text.trim() !== state.pending.originalText }] };
  }
  if (event.type === "FIRST_TOKEN") return { ...state, latency: { ...state.latency, firstAgentTokenAt: state.latency.firstAgentTokenAt ?? event.at } };
  if (event.type === "FIRST_AUDIO") {
    const speechEndedAt = state.latency.speechEndedAt;
    const finalTranscriptAt = state.latency.finalTranscriptAt;
    return { ...state, latency: { ...state.latency, firstAudioAt: state.latency.firstAudioAt ?? event.at, speechToAudioMs: speechEndedAt === undefined ? undefined : Math.max(0, event.at - speechEndedAt), transcriptToAudioMs: finalTranscriptAt === undefined ? undefined : Math.max(0, event.at - finalTranscriptAt) } };
  }
  if (event.type === "INTERRUPTION") {
    const cooldown = event.cooldownMs ?? 1500;
    if (!event.confirmed || (state.lastInterruptionAt !== undefined && event.at - state.lastInterruptionAt < cooldown)) return { ...state, filteredInterruptions: state.filteredInterruptions + 1 };
    return { ...state, interruptions: state.interruptions + 1, lastInterruptionAt: event.at };
  }
  return { ...state, pending: null, ended: true };
}
