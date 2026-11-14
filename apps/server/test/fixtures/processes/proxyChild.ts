// TP-8.14 fixture (test-architect's): installs F-122's proxy support from the environment, then
// fetches TARGET_URL and prints {"status":n} on stdout. Run with tsx; the target's self-signed
// certificate is trusted through NODE_EXTRA_CA_CERTS.
import { installProxySupport } from "../../../src/platform/crypto/proxy.js";

installProxySupport(process.env);
const response = await fetch(process.env["TARGET_URL"] ?? "");
process.stdout.write(`${JSON.stringify({ status: response.status })}\n`);
