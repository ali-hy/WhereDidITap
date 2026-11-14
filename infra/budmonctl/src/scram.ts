// F-190: a SCRAM-SHA-256 verifier (RFC 5802/7677) in Postgres's stored format, so a role password
// can be set without the password itself reaching the server.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export function scramVerifier(
  password: string,
  opts: { salt?: Buffer; iterations?: number } = {},
): string {
  const salt = opts.salt ?? randomBytes(16);
  const iterations = opts.iterations ?? 4096;
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", saltedPassword).update("Server Key").digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
