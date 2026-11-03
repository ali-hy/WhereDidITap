// TP-4.2 to TP-4.4's spike contract (S-4): money in the input and the output, a nested object, a
// discriminated union, a nullable field and an enum. Test-architect's fixture.
import { z } from "zod";
import { CurrencyCodeSchema, MoneyAmount, base } from "../../src/index.js";

const Kind = z.enum(["income", "expense"]);

const Detail = z.discriminatedUnion("type", [
  z.object({ type: z.literal("card"), last4: z.string().regex(/^\d{4}$/) }),
  z.object({ type: z.literal("cash") }),
]);

export const spike = {
  p: base
    .route({ method: "POST", path: "/spike" })
    .input(
      z.object({
        amount: MoneyAmount,
        currency: CurrencyCodeSchema,
        nested: z.object({ note: z.string().max(100).nullable() }),
        detail: Detail,
        kind: Kind,
      }),
    )
    .output(
      z.object({
        amount: MoneyAmount,
        nested: z.object({ total: MoneyAmount }),
        kind: Kind,
        note: z.string().max(100).nullable(),
      }),
    ),
};
