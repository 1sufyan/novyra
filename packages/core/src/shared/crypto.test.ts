import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  DecryptionError,
  canonicalJson,
  createFieldCipher,
  hmacSha256Hex,
  safeEqual,
  sha256Hex,
  verifyHmacSha256Hex,
} from "./crypto.ts";

const key = () => randomBytes(32).toString("base64");

describe("canonicalJson", () => {
  test("is independent of key order at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }),
    );
    expect(sha256Hex(canonicalJson({ a: 1, b: 2 }))).toBe(sha256Hex(canonicalJson({ b: 2, a: 1 })));
  });

  test("keeps array order significant", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("HMAC", () => {
  test("verifies a correct signature and rejects tampering", () => {
    const signature = hmacSha256Hex("secret", '{"amount":"100.00"}');
    expect(verifyHmacSha256Hex("secret", '{"amount":"100.00"}', signature)).toBe(true);
    expect(verifyHmacSha256Hex("secret", '{"amount":"100.01"}', signature)).toBe(false);
    expect(verifyHmacSha256Hex("other", '{"amount":"100.00"}', signature)).toBe(false);
    expect(verifyHmacSha256Hex("secret", '{"amount":"100.00"}', signature.toUpperCase())).toBe(true);
  });

  test("safeEqual handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("field cipher (AES-256-GCM)", () => {
  test("round-trips and produces a fresh ciphertext each time", () => {
    const cipher = createFieldCipher({ v1: key() }, "v1");
    const a = cipher.encrypt("PK36SCBL0000001123456702", "refund:1:payout");
    const b = cipher.encrypt("PK36SCBL0000001123456702", "refund:1:payout");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(cipher.decrypt(a, "refund:1:payout")).toBe("PK36SCBL0000001123456702");
  });

  test("a ciphertext bound to one record cannot be read as another's", () => {
    const cipher = createFieldCipher({ v1: key() }, "v1");
    const ciphertext = cipher.encrypt("secret", "refund:1:payout");
    expect(() => cipher.decrypt(ciphertext, "refund:2:payout")).toThrow(DecryptionError);
  });

  test("detects tampering", () => {
    const cipher = createFieldCipher({ v1: key() }, "v1");
    const ciphertext = cipher.encrypt("secret", "aad");
    const [version, payload] = ciphertext.split(":") as [string, string];
    const [iv, tag, body] = payload.split(".") as [string, string, string];
    const flipped = Buffer.from(body, "base64url");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => cipher.decrypt(`${version}:${iv}.${tag}.${flipped.toString("base64url")}`, "aad")).toThrow(
      DecryptionError,
    );
    expect(() => cipher.decrypt("v1:not-valid", "aad")).toThrow(DecryptionError);
  });

  test("rejects a truncated authentication tag", () => {
    const cipher = createFieldCipher({ v1: key() }, "v1");
    const [version, payload] = cipher.encrypt("PK36SCBL0000001123456702", "aad").split(":") as [
      string,
      string,
    ];
    const [iv, tag, body] = payload.split(".") as [string, string, string];
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => cipher.decrypt(`${version}:${iv}.${short}.${body}`, "aad")).toThrow(DecryptionError);
  });

  test("supports key rotation: old ciphertexts stay readable, new ones use the current key", () => {
    const v1 = key();
    const old = createFieldCipher({ v1 }, "v1").encrypt("legacy", "aad");
    const rotated = createFieldCipher({ v1, v2: key() }, "v2");
    expect(rotated.decrypt(old, "aad")).toBe("legacy");
    expect(rotated.encrypt("new", "aad").startsWith("v2:")).toBe(true);
    expect(() => createFieldCipher({ v2: key() }, "v2").decrypt(old, "aad")).toThrow(DecryptionError);
  });

  test("rejects bad keys and versions", () => {
    expect(() => createFieldCipher({ v1: randomBytes(16).toString("base64") }, "v1")).toThrow(
      /32 random bytes/,
    );
    // Decodes to 32 bytes with Node's lenient decoder, but is not base64 of a key.
    expect(() => createFieldCipher({ v1: "changeme changeme changeme changeme changeme123" }, "v1")).toThrow(
      /32 random bytes/,
    );
    expect(() => createFieldCipher({ key1: key() }, "key1")).toThrow(/Invalid key version/);
    expect(() => createFieldCipher({ v1: key() }, "v2")).toThrow(/No key/);
  });
});
