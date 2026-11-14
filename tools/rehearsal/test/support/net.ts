// Test helpers for the rehearsal's fakes: a throwaway self-signed certificate, free ports, and
// small HTTPS and plain-HTTP clients that return status, headers and body.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** A self-signed RSA certificate whose SANs are exactly `hosts`. */
export function selfSigned(hosts: readonly string[]): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(path.join(tmpdir(), "budmon-rehearsal-cert-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${hosts[0] ?? "localhost"}`,
        "-addext",
        `subjectAltName=${hosts.map((h) => `DNS:${h}`).join(",")}`,
        "-keyout",
        path.join(dir, "key.pem"),
        "-out",
        path.join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(path.join(dir, "key.pem")),
      cert: readFileSync(path.join(dir, "cert.pem")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => {
        resolve(p);
      });
    });
  });
}

function collect(resolve: (r: Reply) => void): (res: import("node:http").IncomingMessage) => void {
  return (res) => {
    let text = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => (text += c));
    res.on("end", () => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text });
    });
  };
}

/** HTTPS to 127.0.0.1:`port` as `host` (SNI and Host), trusting `ca`. */
export function httpsTo(
  port: number,
  ca: Buffer,
  host: string,
  method: string,
  urlPath: string,
  body?: { type: string; text: string },
): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        servername: host,
        ca,
        headers: { Host: host, ...(body === undefined ? {} : { "Content-Type": body.type }) },
      },
      collect(resolve),
    );
    req.on("error", reject);
    req.end(body?.text);
  });
}

/** Plain HTTP to 127.0.0.1:`port` (the fakes' control servers). */
export function httpTo(
  port: number,
  method: string,
  urlPath: string,
  body?: { type: string; text: string },
): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: body === undefined ? {} : { "Content-Type": body.type },
      },
      collect(resolve),
    );
    req.on("error", reject);
    req.end(body?.text);
  });
}

export const json = (value: unknown) => ({ type: "application/json", text: JSON.stringify(value) });
