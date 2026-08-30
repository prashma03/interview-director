import { describe, expect, it } from "vitest";
import {
  initialInterviewState,
  INTRO_LIMIT_MS,
  reduceInterview,
} from "./interviewMachine";

describe("interview state machine", () => {
  it("moves from briefing to introduction", () => {
    const state = reduceInterview(initialInterviewState, { type: "START", now: 100 });
    expect(state.stage).toBe("introduction");
  });

  it("uses a deterministic timeout fallback", () => {
    const started = reduceInterview(initialInterviewState, { type: "START", now: 100 });
    const state = reduceInterview(started, { type: "TICK", now: 100 + INTRO_LIMIT_MS });
    expect(state.stage).toBe("experience");
    expect(state.transitions.at(-1)?.reason).toBe("time-fallback");
  });

  it("moves on after a complete introduction", () => {
    const started = reduceInterview(initialInterviewState, { type: "START", now: 0 });
    const state = reduceInterview(started, {
      type: "ANSWER",
      now: 10,
      text: "I am a software engineer who builds thoughtful AI products for people. I am looking for a role where I can own ambiguous product problems and I am excited to work across research and engineering.",
    });
    expect(state.stage).toBe("experience");
    expect(state.transitions.at(-1)?.reason).toBe("candidate-ready");
  });

  it("preserves evidence across the handoff", () => {
    const started = reduceInterview(initialInterviewState, { type: "START", now: 0 });
    const first = reduceInterview(started, { type: "ANSWER", now: 10, text: "Short answer" });
    const second = reduceInterview(first, { type: "ANSWER", now: 20, text: "Another short answer" });
    expect(second.stage).toBe("experience");
    expect(second.evidence).toEqual(["Short answer", "Another short answer"]);
  });
});
