import { describe, expect, it } from "vitest";
import { initialRealtimeProtocolState, reduceRealtimeProtocol } from "./realtimeProtocol";

describe("realtime provider boundary", () => {
  it("waits for and preserves an edited transcript confirmation", () => {
    let state = reduceRealtimeProtocol(initialRealtimeProtocolState, { type: "FINAL_TRANSCRIPT", at: 120, id: "t1", text: "Live kit", stageEpoch: 2 });
    expect(state.confirmed).toHaveLength(0);
    state = reduceRealtimeProtocol(state, { type: "CONFIRM", id: "t1", text: "LiveKit", stageEpoch: 2 });
    expect(state.confirmed[0]).toEqual({ id: "t1", text: "LiveKit", edited: true });
  });
  it("rejects a late confirmation from the previous agent epoch", () => {
    const pending = reduceRealtimeProtocol(initialRealtimeProtocolState, { type: "FINAL_TRANSCRIPT", at: 120, id: "t1", text: "Answer", stageEpoch: 2 });
    expect(reduceRealtimeProtocol(pending, { type: "CONFIRM", id: "t1", text: "Answer", stageEpoch: 1 })).toBe(pending);
  });
  it("debounces interruption noise and rapid repeats", () => {
    let state = reduceRealtimeProtocol(initialRealtimeProtocolState, { type: "INTERRUPTION", at: 1_000, confirmed: false });
    state = reduceRealtimeProtocol(state, { type: "INTERRUPTION", at: 2_000, confirmed: true });
    state = reduceRealtimeProtocol(state, { type: "INTERRUPTION", at: 2_400, confirmed: true });
    expect(state).toMatchObject({ interruptions: 1, filteredInterruptions: 2 });
  });
  it("measures end-of-speech latency without claiming unavailable marks", () => {
    let state = reduceRealtimeProtocol(initialRealtimeProtocolState, { type: "SPEECH_ENDED", at: 1_000 });
    state = reduceRealtimeProtocol(state, { type: "FINAL_TRANSCRIPT", at: 1_180, id: "t1", text: "Answer", stageEpoch: 1 });
    state = reduceRealtimeProtocol(state, { type: "FIRST_AUDIO", at: 1_720 });
    expect(state.latency).toMatchObject({ speechToTranscriptMs: 180, transcriptToAudioMs: 540, speechToAudioMs: 720 });
    expect(state.latency.firstAgentTokenAt).toBeUndefined();
  });
  it("cleans pending work on termination and ignores later provider events", () => {
    const pending = reduceRealtimeProtocol(initialRealtimeProtocolState, { type: "FINAL_TRANSCRIPT", at: 120, id: "t1", text: "Answer", stageEpoch: 2 });
    const ended = reduceRealtimeProtocol(pending, { type: "END" });
    expect(ended).toMatchObject({ ended: true, pending: null });
    expect(reduceRealtimeProtocol(ended, { type: "FIRST_AUDIO", at: 500 })).toBe(ended);
  });
});
