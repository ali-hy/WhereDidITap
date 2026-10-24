// F-53: procedure bases. Modules implement procedures only from these.
import { contract } from "@budmon/contract";
import type { AnyContractRouter } from "@orpc/contract";
import {
  implement,
  os,
  type ImplementerInternal,
  type ImplementerInternalWithMiddlewares,
} from "@orpc/server";
import { ForbiddenError, UnauthenticatedError } from "../errors/platformErrors.js";
import type { Principal, RequestContext } from "./context.js";

/** A null principal is UNAUTHENTICATED; afterwards `principal` is non-null (A-123). */
export const requireAuth = os.$context<RequestContext>().middleware(async ({ context, next }) => {
  if (context.principal === null) throw new UnauthenticatedError();
  const principal: Principal = context.principal;
  return next({ context: { principal } });
});

/** After requireAuth: a caller who isn't the owner is FORBIDDEN. */
export const requireOwner = os.$context<RequestContext>().middleware(async ({ context, next }) => {
  if (context.principal?.isOwner !== true) throw new ForbiddenError();
  return next();
});

type AuthedContext = RequestContext & { principal: Principal };

export interface ProcedureBases<C extends AnyContractRouter> {
  base: ImplementerInternal<C, RequestContext, RequestContext>;
  publicProcedure: ImplementerInternal<C, RequestContext, RequestContext>;
  authedProcedure: ImplementerInternalWithMiddlewares<C, RequestContext, AuthedContext>;
  ownerProcedure: ImplementerInternalWithMiddlewares<C, RequestContext, AuthedContext>;
}

/** A-123: the bases for any contract, so tests can build their own. */
export function procedureBases<C extends AnyContractRouter>(c: C): ProcedureBases<C> {
  const base = implement(c).$context<RequestContext>() as ImplementerInternal<
    C,
    RequestContext,
    RequestContext
  >;
  // For a generic contract the implementer's `use` is a union TypeScript can't call; the result
  // types are the ones oRPC gives a concrete router.
  const use = (target: unknown, middleware: unknown): unknown =>
    (target as { use(m: unknown): unknown }).use(middleware);
  const authedProcedure = use(base, requireAuth) as ProcedureBases<C>["authedProcedure"];
  return {
    base,
    publicProcedure: base,
    authedProcedure,
    ownerProcedure: use(authedProcedure, requireOwner) as ProcedureBases<C>["ownerProcedure"],
  };
}

const bases = procedureBases(contract);
export const base = bases.base;
export const publicProcedure = bases.publicProcedure;
export const authedProcedure = bases.authedProcedure;
export const ownerProcedure = bases.ownerProcedure;

/** Dotted contract paths of the procedures on publicProcedure. Modules add theirs. */
export const PUBLIC_PROCEDURES: ReadonlySet<string> = new Set(["meta.clientConfig"]);
