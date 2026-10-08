/**
 * Phase 11 — AI settings secret encryption (AES-256-GCM).
 *
 * The LLM apiKey must be retrievable, so unlike integration tokens (HMAC hash,
 * one-way) it is stored encrypted. The pepper resolution approach mirrors
 * auth/integration-token-crypto.ts, but the key derivation uses a distinct
 * purpose label so ciphertexts can never collide with integration tokens.
 *
 * Never log plaintext secrets, peppers, or ciphertexts.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import { UnauthorizedError } from "@adlinklab/shared";

/** Test-only pepper — never for production. */
export const TEST_AI_SETTINGS_PEPPER =
  "adlinklab-test-ai-settings-pepper-not-for-production";

/** Distinct purpose label: derived keys never collide with integration tokens. */
const KEY_PURPOSE = "adlinklab/ai-settings/v1";

const ENC_PREFIX = "aienc$v1$";

/**
 * Resolve server-side pepper.
 * - Prefer AI_SETTINGS_PEPPER
 * - Fall back to INTEGRATION_TOKEN_PEPPER
 * - Test/Vitest: fall back to TEST pepper (never commit real secrets)
 * - Otherwise: throw (fail closed)
 */
export function resolveAiSettingsPepper(
  env: NodeJS.ProcessEnv = process.env
): string {
  const ai = (env.AI_SETTINGS_PEPPER ?? "").trim();
  if (ai) return ai;
  const integration = (env.INTEGRATION_TOKEN_PEPPER ?? "").trim();
  if (integration) return integration;
  if (env.VITEST || env.NODE_ENV === "test") {
    return TEST_AI_SETTINGS_PEPPER;
  }
  throw new UnauthorizedError("Unauthorized");
}

/** Explicit config check for settings write paths (clearer than 401). */
export function assertAiSettingsPepperConfigured(
  env: NodeJS.ProcessEnv = process.env
): string {
  try {
    return resolveAiSettingsPepper(env);
  } catch {
    throw new Error(
      "AI_SETTINGS_PEPPER (or INTEGRATION_TOKEN_PEPPER) is required for AI settings operations"
    );
  }
}

function deriveKey(pepper: string): Buffer {
  return createHmac("sha256", pepper).update(KEY_PURPOSE, "utf8").digest();
}

/**
 * Encrypt a secret. Returns `aienc$v1$<ivHex>$<cipherHex>$<tagHex>`.
 * The plaintext is never logged by this module.
 */
export function encryptSecret(plain: string, pepper: string): string {
  if (!plain) throw new Error("Cannot encrypt an empty secret");
  const key = deriveKey(pepper);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}$${ciphertext.toString("hex")}$${tag.toString("hex")}`;
}

/**
 * Decrypt a value produced by encryptSecret.
 * Throws (fail closed) on malformed input or authentication failure —
 * never reveals whether the pepper or the ciphertext was wrong.
 */
export function decryptSecret(enc: string, pepper: string): string {
  try {
    if (typeof enc !== "string" || !enc.startsWith(ENC_PREFIX)) {
      throw new Error("bad format");
    }
    const parts = enc.slice(ENC_PREFIX.length).split("$");
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
