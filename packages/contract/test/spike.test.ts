// TP-4.2 (F-340, F-347) and TP-4.4 (contract types) on the spike contract
// (test/fixtures/spikeContract.ts). TP-4.3 (Kotlin generation) is test/kotlin-spike.sh.
import type { InferContractRouterOutputs } from "@orpc/contract";
import { describe, expect, expectTypeOf, it } from "vitest";
import { generate, resolve } from "./fixtures/generate.js";
import { spike } from "./fixtures/spikeContract.js";

const INT64 = {
  type: "integer",
  format: "int64",
  minimum: -9007199254740991,
  maximum: 9007199254740991,
};

type Json = Record<string, unknown>;

function property(doc: Json, schema: unknown, name: string): Json {
  const object = resolve(doc, schema);
  return resolve(doc, (object["properties"] as Json)[name]);
}

describe("TP-4.2: money is int64 with bounds in both directions", () => {
  it("TP-4.2: the input amount schema is exactly the int64 schema", async () => {
    const doc = await generate(spike);
    const post = ((doc["paths"] as Json)["/spike"] as Json)["post"] as Json;
    const body = (((post["requestBody"] as Json)["content"] as Json)["application/json"] as Json)[
      "schema"
    ];

    expect(property(doc, body, "amount")).toEqual(INT64);
  });

  it("TP-4.2: the output amount schemas (top level and nested) are exactly the int64 schema", async () => {
    const doc = await generate(spike);
    const post = ((doc["paths"] as Json)["/spike"] as Json)["post"] as Json;
    const response = (((post["responses"] as Json)["200"] as Json)["content"] as Json)[
      "application/json"
    ] as Json;

    expect(property(doc, response["schema"], "amount")).toEqual(INT64);
    expect(property(doc, property(doc, response["schema"], "nested"), "total")).toEqual(INT64);
  });
});

describe("TP-4.4: the inferred output type of money is number", () => {
  // A type assertion: `pnpm typecheck` (tsc over packages/*) fails if the type isn't number.
  it("TP-4.4: InferContractRouterOutputs<typeof spike>['p']['amount'] is number", () => {
    expectTypeOf<InferContractRouterOutputs<typeof spike>["p"]["amount"]>().toEqualTypeOf<number>();
    expectTypeOf<
      InferContractRouterOutputs<typeof spike>["p"]["nested"]["total"]
    >().toEqualTypeOf<number>();
  });
});
