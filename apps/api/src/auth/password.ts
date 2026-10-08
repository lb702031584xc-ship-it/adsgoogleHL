import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing — scrypt (node:crypto, no extra dependencies).
 * Stored format: `scrypt$<saltHex>$<hashHex>` (16-byte salt, N=16384, r=8, p=1, 64-byte key).
 */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const PREFIX = "scrypt";

export function hashPassword(plain: string): string {
  if (!plain) {
    throw new Error("hashPassword: password must not be empty");
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const [, saltHex, hashHex] = parts as [string, string, string];
  let salt: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES) return false;
  const candidate = scryptSync(plain, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return safeEqualHex(candidate.toString("hex"), hashHex);
}
