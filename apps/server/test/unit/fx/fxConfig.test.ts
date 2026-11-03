// F-10's FX_PROVIDER for a general worker (A-276). TP-9.21.
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../../src/platform/config/loadConfig.js";
import {
  devWorker,
  prodWorkerGeneral,
  readFileFrom,
  type Fixture,
} from "../../support/configEnv.js";

function generalWithoutFxProvider(f: Fixture, appEnv: string): Fixture {
  f.env["WORKER_ROLES"] = "general";
  f.env["APP_ENV"] = appEnv;
  delete f.env["FX_PROVIDER"];
  return f;
}

describe("TP-9.21: FX_PROVIDER absent on a general worker (F-10, A-276)", () => {
  it.each([["development"], ["test"]])("TP-9.21: in %s it is fixed", (appEnv) => {
    const f = generalWithoutFxProvider(devWorker(), appEnv);

    const config = loadConfig("worker", f.env, readFileFrom(f.files));

    expect(config.fx).toEqual({ provider: "fixed" });
  });

  it.each([["rehearsal"], ["production"]] as const)(
    "TP-9.21: in %s it is one problem FX_PROVIDER required",
    (appEnv) => {
      const f = generalWithoutFxProvider(prodWorkerGeneral(appEnv), appEnv);
      let caught: unknown;

      try {
        loadConfig("worker", f.env, readFileFrom(f.files));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).problems).toEqual([
        { variable: "FX_PROVIDER", rule: "required" },
      ]);
    },
  );
});
