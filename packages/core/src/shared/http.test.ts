import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { HttpRequestBlockedError, createHttpClient } from "./http.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/ok") return res.end("ok");
    if (req.url === "/redirect-internal") {
      res.writeHead(302, { location: "/ok" });
      return res.end();
    }
    if (req.url === "/redirect-external") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return res.end();
    }
    if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      return res.end();
    }
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 500);
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const client = (overrides: Partial<Parameters<typeof createHttpClient>[0]> = {}) =>
  createHttpClient({ name: "test", allowedHosts: ["127.0.0.1"], allowInsecureLocalhost: true, ...overrides });

describe("createHttpClient", () => {
  test("allows allowlisted hosts", async () => {
    const response = await client()(`${base}/ok`);
    expect(await response.text()).toBe("ok");
  });

  test("blocks hosts outside the allowlist", async () => {
    await expect(client({ allowedHosts: ["api.example.com"] })(`${base}/ok`)).rejects.toThrow(
      HttpRequestBlockedError,
    );
  });

  test("requires https unless insecure localhost is explicitly allowed", async () => {
    await expect(client({ allowInsecureLocalhost: false })(`${base}/ok`)).rejects.toThrow(/only https/);
    await expect(
      createHttpClient({ name: "x", allowedHosts: ["example.com"] })("http://example.com/"),
    ).rejects.toThrow(/only https/);
  });

  test("follows redirects within the allowlist only", async () => {
    expect(await (await client()(`${base}/redirect-internal`)).text()).toBe("ok");
    await expect(client()(`${base}/redirect-external`)).rejects.toThrow(/not in the allowlist/);
    await expect(client()(`${base}/loop`)).rejects.toThrow(/too many redirects/);
  });

  test("times out", async () => {
    await expect(client({ timeoutMs: 50 })(`${base}/slow`)).rejects.toThrow();
  });
});
