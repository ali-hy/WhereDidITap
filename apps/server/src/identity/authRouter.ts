// F-36: the `auth.*` procedures. S-1 has the public sign-up options.
import { publicProcedure } from "../platform/http/procedures.js";
import { signUpOptions } from "./signInService.js";

export const authRouter = {
  signUpOptions: publicProcedure.auth.signUpOptions.handler(({ context }) =>
    signUpOptions(context.container.identity.deps),
  ),
};
