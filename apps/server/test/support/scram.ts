// A SCRAM-SHA-256 verifier for tests (RFC 5802/7677), in the format F-190 produces:
// SCRAM-SHA-256$<iterations>:<b64 salt>$<b64 StoredKey>:<b64 ServerKey>.
// F-190 (`budmonctl`) arrives in S-15; TP-2.10 (b) needs a verifier in S-2.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export function testScramVerifier(password: string, iterations = 4096): string {
  const salt = randomBytes(16);
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
