// Imported first by the web app: zod's JIT probe calls `Function("")`, which a strict CSP
// (no 'unsafe-eval') reports as a violation. Schemas parse without it.
import { config } from "zod/v4/core";

config({ jitless: true });
