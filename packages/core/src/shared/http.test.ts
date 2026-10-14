import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { HttpRequestBlockedError, createHttpClient } from "./http.ts";

let server: Server;
let base: string;
let port: number;

interface Seen {
  method: string;
  url: string;
  host: string;
  authorization?: string;
  contentType?: string;
  body: string;
}
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += String(chunk);
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      host: req.headers.host ?? "",
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      body,
    });
    if (req.url === "/ok") return res.end("ok");
    if (req.url === "/pay") {
      res.writeHead(303, { location: "/status/1" });
      return res.end();
    }
    if (req.url === "/pay-elsewhere") {
      res.writeHead(303, { location: `http://localhost:${port}/status/1` });
      return res.end();
    }
    if (req.url === "/pay-temporary") {
      res.writeHead(307, { location: "/pay-here" });
      return res.end();
    }
    if (req.url?.startsWith("/status") || req.url === "/pay-here") return res.end("done");
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
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
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

  test("returns redirects unfollowed by default", async () => {
    const response = await client()(`${base}/redirect-external`);
    expect(response.status).toBe(302);
  });

  test("when enabled, follows redirects within the allowlist only", async () => {
    const following = client({ maxRedirects: 3 });
    expect(await (await following(`${base}/redirect-internal`)).text()).toBe("ok");
    await expect(following(`${base}/redirect-external`)).rejects.toThrow(/not in the allowlist/);
    await expect(following(`${base}/loop`)).rejects.toThrow(/too many redirects/);
  });

  const payment = {
    method: "POST",
    headers: { authorization: "Bearer SECRET", "content-type": "application/json" },
    body: JSON.stringify({ amount: "125000.00" }),
  };

  test("a 303 after a POST is followed with a body-less GET, like fetch()", async () => {
    seen.length = 0;
    await client({ maxRedirects: 3 })(`${base}/pay`, payment);
    expect(seen[1]).toMatchObject({ method: "GET", url: "/status/1", body: "" });
    expect(seen[1]!.contentType).toBeUndefined();
    expect(seen[1]!.authorization).toBe("Bearer SECRET");
  });

  test("credentials are not sent to another origin", async () => {
    seen.length = 0;
    await client({ allowedHosts: ["127.0.0.1", "localhost"], maxRedirects: 3 })(
      `${base}/pay-elsewhere`,
      payment,
    );
    expect(seen[1]).toMatchObject({ host: `localhost:${port}`, method: "GET" });
    expect(seen[1]!.authorization).toBeUndefined();
  });

  test("a 307 repeats the method and body, but never a stream", async () => {
    seen.length = 0;
    await client({ maxRedirects: 3 })(`${base}/pay-temporary`, payment);
    expect(seen[1]).toMatchObject({ method: "POST", url: "/pay-here", body: payment.body });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk"));
        controller.close();
      },
    });
    await expect(
      client({ maxRedirects: 3 })(`${base}/pay-temporary`, {
        method: "POST",
        body: stream,
        duplex: "half",
      } as RequestInit),
    ).rejects.toThrow(/streamed request body/);
  });

  test("times out", async () => {
    await expect(client({ timeoutMs: 50 })(`${base}/slow`)).rejects.toThrow();
  });
});
