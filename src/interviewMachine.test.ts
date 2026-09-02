import { describe, expect, it } from "vitest";
import { answerGuidance, EXPERIENCE_LIMIT_MS, EXPERIENCE_TURN_LIMIT, extractSignals, initialInterviewState, INTRO_LIMIT_MS, INTRO_TURN_LIMIT, MAX_FOLLOW_UPS, reduceInterview } from "./interviewMachine";
const start = () => reduceInterview(initialInterviewState, { type: "START", now: 100 });
const introComplete = () => {
  let state = start();
  const text = "I am an engineer who built reliable systems. My strength is ownership, and I want to lead meaningful problems next because this role and team fit that direction.";
  state = reduceInterview(state, { type: "ANSWER", now: 1_000, text });
  return reduceInterview(state, { type: "ANSWER", now: 2_000, text });
};

describe("adaptive interview director", () => {
  it("extracts employer-relevant evidence instead of scoring answer length", () => {
    expect(extractSignals("experience", "I personally designed the API because the alternative increased latency; usage improved 25%.")).toEqual(expect.arrayContaining(["ownership", "reasoning", "impact"]));
  });
  it("asks a targeted follow-up for the highest-value missing signal", () => {
    const state = reduceInterview(start(), { type: "ANSWER", now: 10_000, durationMs: 40_000, text: "I am a software engineer. I want more ownership in my next role because this team works on meaningful problems." });
    expect(state.currentPrompt).toContain("strength");
    expect(state.promptReason).toContain("demonstrated strengths");
  });
  it("never asks more than two follow-ups before moving forward", () => {
    let state = start();
    for (let i = 0; i < MAX_FOLLOW_UPS + 1; i += 1) state = reduceInterview(state, { type: "ANSWER", now: 1_000 + i, durationMs: 20_000, text: "A brief answer without the requested evidence." });
    expect(state.followUpCount).toBe(0);
    expect(state.primaryQuestion).toBe(1);
  });
  it("preserves a deterministic stage timeout fallback", () => {
    const state = reduceInterview(start(), { type: "TICK", now: 100 + INTRO_LIMIT_MS });
    expect(state.stage).toBe("experience");
    expect(state.transitions.at(-1)?.reason).toBe("time-fallback");
  });
  it("transitions normally from introduction to experience after both primaries and required evidence", () => {
    const state = introComplete();
    expect(state.stage).toBe("experience");
    expect(state.transitions.at(-1)?.reason).toBe("evidence-complete");
  });
  it("uses the configured introduction turn-limit fallback", () => {
    let state = start();
    for (let index = 0; index < INTRO_TURN_LIMIT; index += 1) state = reduceInterview(state, { type: "ANSWER", now: 1_000 + index, text: "Brief unclear answer." });
    expect(state.stage).toBe("experience");
    expect(state.transitions.at(-1)?.reason).toBe("question-limit");
  });
  it("transitions normally from experience to debrief and preserves introduction evidence", () => {
    let state = introComplete();
    const before = state.evidence.length;
    const text = "The customer had a difficult latency problem. I personally designed the API because I rejected a batch alternative; it reduced latency 35%, and in hindsight I would redesign monitoring.";
    for (let index = 0; index < 3; index += 1) state = reduceInterview(state, { type: "ANSWER", now: 3_000 + index, text });
    expect(state.stage).toBe("debrief");
    expect(state.transitions.at(-1)?.reason).toBe("evidence-complete");
    expect(state.evidence.slice(0, before).every((record) => record.stage === "introduction")).toBe(true);
  });
  it("applies the experience time fallback", () => {
    const state = introComplete();
    const next = reduceInterview(state, { type: "TICK", now: state.stageStartedAt + EXPERIENCE_LIMIT_MS });
    expect(next.stage).toBe("debrief");
    expect(next.transitions.at(-1)?.reason).toBe("time-fallback");
  });
  it("has a finite configured experience turn limit", () => {
    let state = introComplete();
    for (let index = 0; index < EXPERIENCE_TURN_LIMIT; index += 1) state = reduceInterview(state, { type: "ANSWER", now: 3_000 + index, text: "Brief unclear answer." });
    expect(state.stage).toBe("debrief");
    expect(state.transitions.at(-1)?.reason).toBe("question-limit");
  });
  it("does not repeat the opening prompt or transition twice", () => {
    const state = start();
    const duplicate = reduceInterview(state, { type: "START", now: 101, eventId: "second-start", stageEpoch: state.stageEpoch });
    expect(duplicate.currentPrompt).toBe(state.currentPrompt);
    expect(duplicate.transitions).toHaveLength(state.transitions.length);
  });
  it("provides soft guidance without a countdown", () => {
    expect(answerGuidance(0, 10_000).text).toContain("Take your time");
    expect(answerGuidance(0, 130_000).tone).toBe("guide");
  });
  it("records long-answer redirection without penalizing the candidate", () => {
    const state = reduceInterview(start(), { type: "ANSWER", now: 200_000, durationMs: 160_000, text: "I am an engineer looking for my next role because I want to own larger systems." });
    expect(state.directorNotes.some((note) => note.kind === "redirect")).toBe(true);
  });
  it("stores candidate-confirmed transcript evidence and records corrections", () => {
    const state = reduceInterview(start(), { type: "ANSWER", now: 10_000, durationMs: 20_000, text: "I am an engineer.", transcriptEdited: true });
    expect(state.evidence[0]).toMatchObject({ answer: "I am an engineer.", candidateConfirmed: true, transcriptEdited: true });
  });
  it("deduplicates events and rejects responses from an old stage epoch", () => {
    const state = start();
    const once = reduceInterview(state, { type: "ANSWER", now: 1_000, eventId: "turn-1", stageEpoch: state.stageEpoch, text: "I am an engineer." });
    expect(reduceInterview(once, { type: "ANSWER", now: 1_001, eventId: "turn-1", stageEpoch: state.stageEpoch, text: "duplicate" })).toBe(once);
    expect(reduceInterview(once, { type: "ANSWER", now: 1_002, eventId: "late", stageEpoch: state.stageEpoch - 1, text: "stale" })).toBe(once);
  });
  it("records an auditable trigger and ignores timers after the session ends", () => {
    const debrief = reduceInterview(start(), { type: "END", now: 2_000, timestamp: 20_000 });
    const ended = reduceInterview(debrief, { type: "END", now: 3_000, timestamp: 30_000 });
    expect(ended.transitions.at(-1)).toMatchObject({ from: "debrief", to: "ended", triggerType: "END", at: 30_000 });
    expect(ended.transitions.at(-1)?.explanation).toContain("explicit control");
    expect(reduceInterview(ended, { type: "TICK", now: 999_999 })).toEqual(ended);
  });
});
