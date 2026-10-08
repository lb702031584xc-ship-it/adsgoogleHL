/**
 * Network API framework — credential encryption (AES-256-GCM).
 *
 * Mirrors apps/api/src/ai/crypto.ts, with a distinct key purpose label
 * ("adlinklab/network-api/v1") and a distinct wire prefix ("enc:v1:") so
 * ciphertexts can never be confused with AI settings secrets.
 *
 * Wire format: `enc:v1:<ivHex>:<cipherHex>:<tagHex>`
 * The plaintext apiKey is never logged, never returned to callers of
 * the management API, and never stored outside this encrypted reference.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { UnauthorizedError } from "@adlinklab/shared";

/** Test-only pepper — never for production. */
export const TEST_NETWORK_API_PEPPER =
  "adlinklab-test-network-api-pepper-not-for-production";

const KEY_PURPOSE = "adlinklab/network-api/v1";

export const ENC_PREFIX = "enc:v1:";

export function resolveNetworkApiPepper(
  env: NodeJS.ProcessEnv = process.env
): string {
  const net = (env.NETWORK_API_PEPPER ?? "").trim();
  if (net) return net;
  const ai = (env.AI_SETTINGS_PEPPER ?? "").trim();
  if (ai) return ai;
  const integration = (env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (integration) return integration;
  if (env.VITEST || env.NODE_ENV === "test") {
    return TEST_NETWORK_API_PEPPER;
  }
  throw new UnauthorizedError("Unauthorized");
}

export function assertNetworkApiPepperConfigured(
  env: NodeJS.ProcessEnv = process.env
): string {
  try {
    return resolveNetworkApiPepper(env);
  } catch {
    throw new Error(
      "NETWORK_API_PEPPER (or AI_SETTINGS_PEPPER / INTEGRATION_TOKEN_PEPPER) is required for network API operations"
    );
  }
}

function deriveKey(pepper: string): Buffer {
  return createHmac("sha256", pepper).update(KEY_PURPOSE, "utf8").digest();
}

export function encryptApiKey(plain: string, pepper: string): string {
  if (!plain) throw new Error("Cannot encrypt an empty API key");
  const key = deriveKey(pepper);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${ciphertext.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptApiKey(enc: string, pepper: string): string {
  try {
    if (typeof enc !== "string" || !enc.startsWith(ENC_PREFIX)) {
      throw new Error("bad format");
    }
    const parts = enc.slice(ENC_PREFIX.length).split(":");
    if (parts.length !== 3) throw new Error("bad format");
    const [ivHex, ctHex, tagHex] = parts as [string, string, string];
    const key = deriveKey(pepper);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ctHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
    if (!plain) throw new Error("empty plaintext");
    return plain;
  } catch {
    throw new UnauthorizedError("Unauthorized");
  }
}

/** Ciphertext-shaped check (for validation error messages, not auth). */
export function isEncryptedApiKeyRef(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(ENC_PREFIX) &&
    value.split(":").length === 4
  );
}
