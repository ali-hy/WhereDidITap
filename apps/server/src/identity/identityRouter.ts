// F-36: identity's router. It grows with the contract: each slice adds its procedures.
import { authRouter } from "./authRouter.js";
import { invitationsRouter } from "./invitationsRouter.js";
import { meRouter } from "./meRouter.js";

export const identityRouter = { auth: authRouter, me: meRouter, invitations: invitationsRouter };
