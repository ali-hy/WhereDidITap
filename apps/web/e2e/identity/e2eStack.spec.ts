// TP-0.39: identity's e2e block in the stack (platform A-509, identity LLD §10.1): the S-0 test
// routes under /api/v1/__test/, served through vite preview's /api proxy. (Every platform spec
// still passing with the block present is the rest of TP-0.39.) Plus extra cases TP-0.39x.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures.js";

const TOKEN = /^bmi_[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const uniqueEmail = () => `e2e-${randomUUID()}@example.invalid`;

test.describe.configure({ mode: "serial" });

test("TP-0.39: DELETE /api/v1/__test/emails is 204, then GET is 200 []", async ({ request }) => {
  const cleared = await request.delete("/api/v1/__test/emails");
  const listed = await request.get("/api/v1/__test/emails");

  expect(cleared.status()).toBe(204);
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toEqual([]);
});

test("TP-0.39: POST /api/v1/__test/invitations { email } is 200 { token, invitationId } with a bmi_ token", async ({
  request,
}) => {
  const res = await request.post("/api/v1/__test/invitations", { data: { email: uniqueEmail() } });

  expect(res.status()).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["invitationId", "token"]);
  expect(body["token"]).toMatch(TOKEN);
  expect(body["invitationId"]).toMatch(UUID);
});

test('TP-0.39: POST /api/v1/__test/invitations with state "unknown" is 400', async ({
  request,
}) => {
  const res = await request.post("/api/v1/__test/invitations", {
    data: { email: uniqueEmail(), state: "unknown" },
  });

  expect(res.status()).toBe(400);
});

test("TP-0.39: POST /api/v1/__test/sessions/unconfirm for an unknown email is 404", async ({
  request,
}) => {
  const res = await request.post("/api/v1/__test/sessions/unconfirm", {
    data: { email: "nobody@example.invalid" },
  });

  expect(res.status()).toBe(404);
});

test.describe("TP-0.39x: the test routes' other inputs", () => {
  for (const state of ["pending", "expired", "revoked"] as const) {
    test(`TP-0.39x: state ${state} is 200 with a bmi_ token`, async ({ request }) => {
      const res = await request.post("/api/v1/__test/invitations", {
        data: { email: uniqueEmail(), state },
      });

      expect(res.status()).toBe(200);
      expect(((await res.json()) as { token: string }).token).toMatch(TOKEN);
    });
  }

  for (const [label, extra] of [
    ["expiresInSeconds 1", { expiresInSeconds: 1 }],
    ["expiresInSeconds 604800", { expiresInSeconds: 604800 }],
  ] as const) {
    test(`TP-0.39x: ${label} is 200`, async ({ request }) => {
      const res = await request.post("/api/v1/__test/invitations", {
        data: { email: uniqueEmail(), ...extra },
      });

      expect(res.status()).toBe(200);
    });
  }

  for (const [label, body] of [
    ["expiresInSeconds 0", { email: "a@example.invalid", expiresInSeconds: 0 }],
    ["expiresInSeconds 604801", { email: "b@example.invalid", expiresInSeconds: 604801 }],
    ["no email", {}],
    ["an unknown inviterEmail field type", { email: "c@example.invalid", inviterEmail: 42 }],
  ] as const) {
    test(`TP-0.39x: ${label} is 400`, async ({ request }) => {
      const res = await request.post("/api/v1/__test/invitations", { data: body });

      expect(res.status()).toBe(400);
    });
  }
});
