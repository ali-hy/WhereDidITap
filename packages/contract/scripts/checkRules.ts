// F-348's CI step: the committed openapi.json follows the contract rules.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAPIV3_1 } from "openapi-types";
import { checkContractRules } from "../src/rules/contractRules.js";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "openapi.json");
const violations = checkContractRules(
  JSON.parse(readFileSync(file, "utf8")) as OpenAPIV3_1.Document,
);
for (const v of violations) process.stderr.write(`${v.rule} ${v.location}\n`);
process.exitCode = violations.length === 0 ? 0 : 1;
