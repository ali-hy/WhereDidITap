// F-195 doctorVerdict (A-468): a doctored run passes only when the expected step is the first to
// fail (a sub-step counts as its step) and cleanup is ok. TP-16.23.
import { beforeAll, describe, expect, it } from "vitest";
import { loadRun, type RunModule, type StepRecord } from "./support/load.js";

let m: RunModule;
beforeAll(async () => {
  m = await loadRun();
});

const ok = (name: string): StepRecord => ({ name, ok: true, detail: "" });
const bad = (name: string): StepRecord => ({ name, ok: false, detail: "x" });
const BEFORE = ["secrets", "previous-db", "migrate", "stack-up", "ready", "canary-flows", "scan"];

describe("TP-16.23: doctorVerdict (F-195, A-468)", () => {
  it("TP-16.23 (a): every record ok → ok false, no step failed", () => {
    const steps = [...BEFORE, "no-stage-setting", "cross-role-secrets", "artifacts", "cleanup"].map(
      ok,
    );

    expect(m.doctorVerdict(steps, "cross-role-secrets")).toEqual({
      ok: false,
      message: "doctored: expected cross-role-secrets to fail, but no step failed",
    });
  });

  it("TP-16.23 (b): no-stage-setting failed first → ok false, names it", () => {
    const steps = [...BEFORE.map(ok), bad("no-stage-setting"), ok("artifacts"), ok("cleanup")];

    expect(m.doctorVerdict(steps, "cross-role-secrets")).toEqual({
      ok: false,
      message: "doctored: expected cross-role-secrets to fail, but no-stage-setting failed first",
    });
  });

  it("TP-16.23 (c): cross-role-secrets failed, artifacts and cleanup ok → ok true", () => {
    const steps = [
      ...BEFORE.map(ok),
      ok("no-stage-setting"),
      bad("cross-role-secrets"),
      ok("artifacts"),
      ok("cleanup"),
    ];

    expect(m.doctorVerdict(steps, "cross-role-secrets")).toEqual({
      ok: true,
      message: "doctored: cross-role-secrets failed as expected",
    });
  });

  it("TP-16.23 (d): as (c) with cleanup failing → ok false", () => {
    const steps = [
      ...BEFORE.map(ok),
      ok("no-stage-setting"),
      bad("cross-role-secrets"),
      ok("artifacts"),
      bad("cleanup"),
    ];

    expect(m.doctorVerdict(steps, "cross-role-secrets")).toEqual({
      ok: false,
      message: "doctored: cross-role-secrets failed as expected, but cleanup failed",
    });
  });

  it("TP-16.23 (e): expectStep canary-flows and a failed canary-flows/bootstrap-owner sub-step → ok true", () => {
    const steps = [
      ...["secrets", "previous-db", "migrate", "stack-up", "ready", "canary-flows"].map(ok),
      bad("canary-flows/bootstrap-owner"),
      ok("artifacts"),
      ok("cleanup"),
    ];

    expect(m.doctorVerdict(steps, "canary-flows")).toEqual({
      ok: true,
      message: "doctored: canary-flows failed as expected",
    });
  });

  it("TP-16.23 (f): only artifacts failing → as (a)", () => {
    const steps = [...BEFORE.map(ok), ok("cross-role-secrets"), bad("artifacts"), ok("cleanup")];

    expect(m.doctorVerdict(steps, "cross-role-secrets")).toEqual({
      ok: false,
      message: "doctored: expected cross-role-secrets to fail, but no step failed",
    });
  });
});
