// F-195 step 9's stageSettingMentions (A-477): whole underscore-delimited env key names and whole
// path tokens in mounts; values ignored. TP-16.27.
import { beforeAll, describe, expect, it } from "vitest";
import { loadRun, type RunModule } from "./support/load.js";

let m: RunModule;
beforeAll(async () => {
  m = await loadRun();
});

describe("TP-16.27: stageSettingMentions (A-477)", () => {
  it("TP-16.27: the matching env keys, then the matching mounts' destinations, in input order", () => {
    const result = m.stageSettingMentions({
      Env: [
        "BUDMON_STAGE=1",
        "STAGE=0",
        "INFRA_STAGE=x",
        "STAGE_NAME=p",
        "MY_HOST_ROLE=a",
        "DEPLOYMENT=d",
        "BACKSTAGE=1",
        "STAGED=1",
        "HOST=h",
        "ROLE=r",
        "APP_ENV=rehearsal",
        "FOO=STAGE",
        "NOEQUALS",
      ],
      Mounts: [
        { Source: "/etc/budmon/stage.env", Destination: "/run/stage.env" },
        { Source: "/run/secrets", Destination: "/run/secrets" },
        { Source: "/data/backstage", Destination: "/data" },
        { Source: "/tmp/budmon-rehearsal-abc/home/x", Destination: "/run/x" },
        { Source: "/a", Destination: "/etc/Host-Role" },
      ],
    });

    expect(result).toEqual([
      "BUDMON_STAGE",
      "STAGE",
      "INFRA_STAGE",
      "STAGE_NAME",
      "MY_HOST_ROLE",
      "DEPLOYMENT",
      "/run/stage.env",
      "/etc/Host-Role",
    ]);
  });

  it("TP-16.27: Env null and Mounts null → []", () => {
    expect(m.stageSettingMentions({ Env: null, Mounts: null })).toEqual([]);
  });
});
