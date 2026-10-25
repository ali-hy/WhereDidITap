// Writes the spike contract's OpenAPI document (F-347's generator configuration) to the path in
// argv[2], for TP-4.3. Test-architect's helper.
import { writeFileSync } from "node:fs";
import { generate } from "../fixtures/generate.js";
import { spike } from "../fixtures/spikeContract.js";

const out = process.argv[2];
if (out === undefined) throw new Error("usage: emitSpike.ts <out.json>");
writeFileSync(out, `${JSON.stringify(await generate(spike), null, 2)}\n`);
