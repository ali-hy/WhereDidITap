// F-349: every procedure of a contract router with its dotted path, method and OpenAPI route.
import { isContractProcedure, type AnyContractRouter } from "@orpc/contract";

export function listProcedures(
  c: AnyContractRouter,
  prefix = "",
): { path: string; method: string; route: string }[] {
  if (isContractProcedure(c)) {
    const route = c["~orpc"].route;
    return [{ path: prefix, method: route.method ?? "POST", route: route.path ?? "" }];
  }
  return Object.entries(c).flatMap(([key, child]) =>
    listProcedures(child as AnyContractRouter, prefix === "" ? key : `${prefix}.${key}`),
  );
}
