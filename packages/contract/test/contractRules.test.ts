// F-348 checkContractRules. TP-4.5: one fixture document violating each of R1 to R6, and a clean
// one, with R4's A-165 and A-173 cases; plus extra cases TP-4.31x (the real contract's emitted
// document is clean). IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// The clean document is generated (F-347's configuration) from a small contract built with F-343's
// createRoute and F-344's list schemas, so it has exactly the shapes the rules expect; each
// violating document is a copy with one change. A location is a JSON pointer; the tests check that
// it points into the operation concerned (and, for schema rules, at the offending property).
import { z } from "zod";
import type { OpenAPIV3_1 } from "openapi-types";
import { describe, expect, it } from "vitest";
import { MoneyAmount, UuidSchema, base, createRoute, listInput, listOutput } from "../src/index.js";
import { checkContractRules } from "../src/rules/contractRules.js";
import { emitOpenapi } from "../scripts/emitOpenapi.js";
import { arr, generate, obj, type JsonObject } from "./fixtures/generate.js";

const thingsContract = {
  things: {
    list: base
      .route({ method: "GET", path: "/things" })
      .input(listInput({ kind: z.enum(["a", "b"]) }))
      .output(listOutput(z.object({ id: UuidSchema, amount: MoneyAmount }))),
    create: createRoute("/things").input(z.object({ name: z.string().max(100) })),
  },
};

async function clean(): Promise<JsonObject> {
  const doc = await generate(thingsContract);
  obj(doc, "paths", "/things", "get")["operationId"] = "things.list";
  obj(doc, "paths", "/things", "post")["operationId"] = "things.create";
  return doc;
}

function check(doc: unknown) {
  return checkContractRules(doc as OpenAPIV3_1.Document);
}

function pointer(location: string): string {
  return location.replace(/^#/, "");
}

const GET = "/paths/~1things/get";
const POST = "/paths/~1things/post";

function listItemSchema(doc: JsonObject): JsonObject {
  return obj(
    doc,
    "paths",
    "/things",
    "get",
    "responses",
    "200",
    "content",
    "application/json",
    "schema",
    "properties",
    "items",
    "items",
  );
}

describe("TP-4.5: checkContractRules", () => {
  it("TP-4.5: the clean document has no violations", async () => {
    expect(check(await clean())).toEqual([]);
  });

  it("TP-4.5: R1, an untyped request body schema", async () => {
    const doc = await clean();
    obj(
      doc,
      "paths",
      "/things",
      "post",
      "requestBody",
      "content",
      "application/json",
      "schema",
      "properties",
    )["name"] = {};

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R1"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(
      new RegExp(`^${POST}/requestBody/.*name`),
    );
  });

  it("TP-4.5: R2, an int64 without maximum", async () => {
    const doc = await clean();
    delete obj(listItemSchema(doc), "properties", "amount")["maximum"];

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R2"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(
      new RegExp(`^${GET}/responses/.*amount`),
    );
  });

  it("TP-4.5: R3, a number without x-budmon-allow-number", async () => {
    const doc = await clean();
    obj(listItemSchema(doc), "properties")["ratio"] = { type: "number" };

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R3"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${GET}/responses/.*ratio`));
  });

  it("TP-4.5: R4, a free-text string query parameter on a GET", async () => {
    const doc = await clean();
    arr(doc, "paths", "/things", "get", "parameters").push({
      name: "q",
      in: "query",
      required: false,
      schema: { type: "string" },
    });

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R4"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${GET}`));
  });

  // A-165: bodies are never coerced, so a body-carrying operation's path parameters are strings.
  function withUpdate(doc: JsonObject, idSchema: JsonObject): JsonObject {
    obj(doc, "paths")["/things/{id}"] = {
      patch: {
        operationId: "things.update",
        parameters: [{ name: "id", in: "path", required: true, schema: idSchema }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string", maxLength: 100 } },
                required: ["name"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
              },
            },
          },
        },
      },
    };
    return doc;
  }

  it("TP-4.5: (A-165) a body-carrying operation with a uuid path parameter is clean", async () => {
    const doc = withUpdate(await clean(), { type: "string", format: "uuid" });

    expect(check(doc)).toEqual([]);
  });

  it("TP-4.5: (A-165) R4, an integer path parameter on an operation with a request body", async () => {
    const doc = withUpdate(await clean(), { type: "integer", minimum: 1, maximum: 1000 });

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R4"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(/^\/paths\/~1things~1\{id\}\/patch/);
  });

  // A-173: a DELETE takes its input from path parameters only, and they are strings.
  const UUID_PARAM = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  function withDelete(doc: JsonObject, operation: JsonObject): JsonObject {
    obj(doc, "paths")["/things/{id}"] = {
      delete: {
        operationId: "things.remove",
        parameters: [UUID_PARAM],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
              },
            },
          },
        },
        ...operation,
      },
    };
    return doc;
  }
  const DELETE_AT = /^\/paths\/~1things~1\{id\}\/delete/;

  it("TP-4.5: (A-173) a DELETE with only a uuid path parameter is clean", async () => {
    expect(check(withDelete(await clean(), {}))).toEqual([]);
  });

  it.each([
    [
      "a query parameter",
      {
        parameters: [
          UUID_PARAM,
          { name: "force", in: "query", required: false, schema: { type: "boolean" } },
        ],
      },
    ],
    [
      "a request body",
      {
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { force: { type: "boolean" } } },
            },
          },
        },
      },
    ],
    [
      "an integer path parameter",
      {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer", minimum: 1, maximum: 1000 },
          },
        ],
      },
    ],
  ])("TP-4.5: (A-173) R4, a DELETE with %s", async (_label, operation: JsonObject) => {
    const violations = check(withDelete(await clean(), operation));

    expect(violations.map((v) => v.rule)).toEqual(["R4"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(DELETE_AT);
  });

  it("TP-4.5: R5, a create without its Idempotency-Key header", async () => {
    const doc = await clean();
    const post = obj(doc, "paths", "/things", "post");
    post["parameters"] = arr(post, "parameters").filter(
      (p) => obj(p)["name"] !== "Idempotency-Key",
    );

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R5"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(new RegExp(`^${POST}`));
  });

  it("TP-4.5: R6, a duplicate operation id", async () => {
    const doc = await clean();
    obj(doc, "paths", "/things", "get")["operationId"] = "things.create";

    const violations = check(doc);

    expect(violations.map((v) => v.rule)).toEqual(["R6"]);
    expect(pointer(violations[0]?.location ?? "")).toMatch(/^\/paths\/~1things\/(get|post)/);
  });
});

describe("TP-4.31x: checkContractRules, further cases (F-348)", () => {
  it("TP-4.31x: the real contract's emitted document is clean", async () => {
    const doc: unknown = JSON.parse(await emitOpenapi());

    expect(check(doc)).toEqual([]);
  });

  it("TP-4.31x: R4, a GET with a request body", async () => {
    const doc = await clean();
    obj(doc, "paths", "/things", "get")["requestBody"] = {
      content: { "application/json": { schema: { type: "object" } } },
    };

    expect(check(doc).map((v) => v.rule)).toContain("R4");
  });

  it("TP-4.31x: R3, a number marked x-budmon-allow-number is allowed", async () => {
    const doc = await clean();
    obj(listItemSchema(doc), "properties")["ratio"] = {
      type: "number",
      "x-budmon-allow-number": true,
    };

    expect(check(doc)).toEqual([]);
  });

  it("TP-4.31x: R5, a create whose 201 response isn't CreatedResult", async () => {
    const doc = await clean();
    obj(doc, "paths", "/things", "post", "responses", "201", "content", "application/json")[
      "schema"
    ] = {
      type: "object",
      properties: { ok: { type: "boolean" } },
    };

    expect(check(doc).map((v) => v.rule)).toEqual(["R5"]);
  });

  it("TP-4.31x: the contract builders never leave a .transform() (R1 on the emitted spike)", async () => {
    const { spike } = await import("./fixtures/spikeContract.js");

    expect(check(await generate(spike))).toEqual([]);
  });
});

describe("TP-7.14: createRoute's OpenAPI shape (F-343)", () => {
  it("TP-7.14: a contract with createRoute('/things') passes R5 (and every rule); the Idempotency-Key header is required with format uuid; the success status is 201", async () => {
    const doc = await generate({
      things: { create: createRoute("/things").input(z.object({ name: z.string().max(100) })) },
    });
    obj(doc, "paths", "/things", "post")["operationId"] = "things.create";

    const post = obj(doc, "paths", "/things", "post");
    const header = arr(post, "parameters")
      .map((p) => obj(p))
      .find((p) => p["name"] === "Idempotency-Key");

    expect(check(doc)).toEqual([]);
    expect(header).toMatchObject({ in: "header", required: true });
    expect(obj(header, "schema")).toMatchObject({ format: "uuid" });
    expect(Object.keys(obj(post, "responses"))).toContain("201");
  });
});
