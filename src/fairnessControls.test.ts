import { describe, expect, it } from "vitest";
import { monitoringPolicy } from "./fairnessControls";

describe("fairness controls", () => {
  it("disables attention monitoring without attaching a scoring consequence", () => {
    const policy = monitoringPolicy(true);
    expect(policy.enabled).toBe(false);
    expect(policy.explanation).toContain("does not affect evidence scoring");
  });

  it("describes standard monitoring without claiming proof", () => {
    expect(monitoringPolicy(false).explanation).toContain("not proof");
  });
});
