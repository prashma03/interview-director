import { describe, expect, it } from "vitest";
import { integrityLabel, summarizeIntegrity } from "./integrityMonitor";

describe("integrity monitor", () => {
  it("summarizes observable attention signals", () => {
    const summary = summarizeIntegrity([{ type: "tab-hidden", at: 1, detail: "hidden" }, { type: "tab-hidden", at: 2, detail: "hidden" }]);
    expect(summary.hidden).toBe(2);
    expect(summary.reviewRecommended).toBe(true);
  });
  it("does not describe an attention change as proof of cheating", () => {
    const summary = summarizeIntegrity([{ type: "paste", at: 1, detail: "12 characters" }]);
    expect(summary.statement).toContain("not proof");
    expect(integrityLabel("tab-hidden")).not.toContain("ChatGPT");
  });
});
