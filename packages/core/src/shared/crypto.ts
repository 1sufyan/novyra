import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** SHA-256 hex digest. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Deterministic JSON: object keys sorted at every level. Two semantically equal requests produce the
 * same string, so their hashes match (idempotency, webhook dedupe).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return val;
  });
}

/** HMAC-SHA256 hex signature. */
export function hmacSha256Hex(secret: string | Uint8Array, data: string | Uint8Array): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Constant-time comparison of two strings (different lengths compare unequal without leaking where). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still spend the comparison time so length mismatches are not trivially faster.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Verifies an HMAC-SHA256 hex signature in constant time. */
export function verifyHmacSha256Hex(
  secret: string | Uint8Array,
  data: string | Uint8Array,
  signature: string,
): boolean {
  return safeEqual(hmacSha256Hex(secret, data), signature.trim().toLowerCase());
}

// ---------------------------------------------------------------------------------------------------
// Field-level encryption (AES-256-GCM) for sensitive columns such as refunds.payout_details_encrypted.
// Ciphertext format: "<version>:<iv>.<tag>.<ciphertext>" (base64url parts). The version selects the
// key, so keys can rotate: encrypt with the current key, decrypt with any key still in the keyring.
// `aad` binds a ciphertext to its row and purpose, so it cannot be copied into another record.
// ---------------------------------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION_PATTERN = /^v\d+$/;

export class DecryptionError extends Error {
  override name = "DecryptionError";
}

export interface FieldCipher {
  encrypt(plaintext: string, aad: string): string;
  decrypt(ciphertext: string, aad: string): string;
}

/**
 * @param keys base64-encoded 32-byte keys by version, e.g. { v1: process.env.DATA_ENCRYPTION_KEY }
 * @param currentVersion the version used for new ciphertexts
 */
export function createFieldCipher(
  keys: Readonly<Record<string, string>>,
  currentVersion: string,
): FieldCipher {
  const keyring = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(keys)) {
    if (!VERSION_PATTERN.test(version))
      throw new Error(`Invalid key version "${version}" (expected v1, v2, …)`);
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error(`Encryption key ${version} must be 32 bytes (base64-encoded)`);
    keyring.set(version, key);
  }
  const currentKey = keyring.get(currentVersion);
  if (!currentKey) throw new Error(`No key for the current version "${currentVersion}"`);

  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, currentKey, iv);
      cipher.setAAD(Buffer.from(aad, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${currentVersion}:${[iv, tag, body].map((part) => part.toString("base64url")).join(".")}`;
    },
    decrypt(ciphertext, aad) {
      const [version, payload] = ciphertext.split(":", 2);
      const key = version ? keyring.get(version) : undefined;
      if (!key || !payload) throw new DecryptionError("Unknown key version or malformed ciphertext");
      const parts = payload.split(".");
      if (parts.length !== 3) throw new DecryptionError("Malformed ciphertext");
      const [iv, tag, body] = parts.map((part) => Buffer.from(part, "base64url")) as [Buffer, Buffer, Buffer];
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAAD(Buffer.from(aad, "utf8"));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch (error) {
        // Wrong key, wrong aad or tampered data: GCM authentication failed.
        throw new DecryptionError("Ciphertext failed authentication", { cause: error });
      }
    },
  };
}
