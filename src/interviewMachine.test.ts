import { describe, expect, it } from "vitest";
import { answerGuidance, extractSignals, initialInterviewState, INTRO_LIMIT_MS, MAX_FOLLOW_UPS, reduceInterview } from "./interviewMachine";
const start = () => reduceInterview(initialInterviewState, { type: "START", now: 100 });

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
  it("provides soft guidance without a countdown", () => {
    expect(answerGuidance(0, 10_000).text).toContain("Take your time");
    expect(answerGuidance(0, 130_000).tone).toBe("guide");
  });
  it("records long-answer redirection without penalizing the candidate", () => {
    const state = reduceInterview(start(), { type: "ANSWER", now: 200_000, durationMs: 160_000, text: "I am an engineer looking for my next role because I want to own larger systems." });
    expect(state.directorNotes.some((note) => note.kind === "redirect")).toBe(true);
  });
});
