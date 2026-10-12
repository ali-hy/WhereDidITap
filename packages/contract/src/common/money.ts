// F-340: money on the wire, a safe integer of minor units, emitted as a bounded int64.
import { JSON_SCHEMA_REGISTRY } from "@orpc/zod/zod4";
import { z } from "zod";

const MAX = 9007199254740991;

export const MoneyAmount = z.number().int().min(-MAX).max(MAX);
JSON_SCHEMA_REGISTRY.add(MoneyAmount, {
  type: "integer",
  format: "int64",
  minimum: -MAX,
  maximum: MAX,
});

export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const MoneySchema = z.object({ amount: MoneyAmount, currency: CurrencyCodeSchema });
