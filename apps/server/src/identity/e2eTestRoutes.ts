// The e2e stack's test-only routes under /api/v1/__test/ (§10.1). They exist only when e2e:serve
// passes them in `identityOverrides.testRoutes`.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INVITATION_TTL } from "./constants.js";
import { isValidEmail, normaliseEmail } from "./emailAddress.js";
import type { MemoryEmailSender } from "./emailSender.js";
import type { IdentityDeps } from "./identityModule.js";
import * as invitationsRepo from "./invitationsRepo.js";
import * as sessionsRepo from "./sessionsRepo.js";
import { generateToken, hashToken } from "./tokens.js";
import * as usersRepo from "./usersRepo.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const UNCONFIRM_AGE_MS = 11 * 60 * 1000;

const Email = z.string().min(1).max(320);

const InvitationBody = z.strictObject({
  email: Email,
  inviterEmail: Email.optional(),
  state: z.enum(["pending", "expired", "revoked"]).optional(),
  expiresInSeconds: z.number().int().min(1).max(604800).optional(),
});

const UnconfirmBody = z.strictObject({ email: Email });

export function registerE2eTestRoutes(
  app: FastifyInstance,
  deps: IdentityDeps,
  opts: { sender: MemoryEmailSender },
): void {
  const h = deps.database.handle;

  app.get("/api/v1/__test/emails", () => opts.sender.sent);

  app.delete("/api/v1/__test/emails", (_req, reply) => {
    opts.sender.clear();
    return reply.status(204).send();
  });

  // A direct invitation with a known token, bypassing the allowance and email.
  app.post("/api/v1/__test/invitations", async (req, reply) => {
    const parsed = InvitationBody.safeParse(req.body);
    const email = parsed.success ? normaliseEmail(parsed.data.email) : "";
    if (!parsed.success || !isValidEmail(email)) return reply.status(400).send();
    const { inviterEmail, state = "pending", expiresInSeconds } = parsed.data;

    const inviter =
      inviterEmail === undefined
        ? null
        : await usersRepo.findByEmail(h, normaliseEmail(inviterEmail));
    const now = deps.clock.now();
    const nowDate = new Date(now.epochMilliseconds);
    const expiresAt =
      state === "expired"
        ? new Date(now.epochMilliseconds - ONE_DAY_MS)
        : expiresInSeconds === undefined
          ? new Date(now.add(INVITATION_TTL).epochMilliseconds)
          : new Date(now.epochMilliseconds + expiresInSeconds * 1000);
    const id = deps.ids.next();
    const token = generateToken("invitation");
    await invitationsRepo.insert(h, {
      id,
      email,
      inviterUserId: inviter?.id ?? null,
      origin: "direct",
      expiresAt,
      tokenHash: hashToken(token),
      tokenIssuedAt: nowDate,
    });
    if (state === "expired") await invitationsRepo.expireIfDue(h, id, nowDate);
    if (state === "revoked") await invitationsRepo.revoke(h, id, null, nowDate);
    return { token, invitationId: id };
  });

  // Makes the next sensitive action ask for step-up, without a server clock.
  app.post("/api/v1/__test/sessions/unconfirm", async (req, reply) => {
    const parsed = UnconfirmBody.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send();
    const user = await usersRepo.findByEmail(h, normaliseEmail(parsed.data.email));
    if (user === null) return reply.status(404).send();
    const now = deps.clock.now();
    const at = new Date(now.epochMilliseconds - UNCONFIRM_AGE_MS);
    for (const session of await sessionsRepo.listLive(
      h,
      user.id,
      new Date(now.epochMilliseconds),
    )) {
      await sessionsRepo.setConfirmed(h, session.id, at);
    }
    return reply.status(204).send();
  });
}
