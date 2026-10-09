/**
 * 流量数据源层的 AiSetting 读取助手。
 *
 * - 密钥类（SimilarWeb key、DataForSEO 账号）：AES 加密存储，
 *   用 assertAiSettingsPepperConfigured() 取 pepper + decryptSecret 解密。
 * - 阈值类（traffic.thresholds）：明文 JSON，见 thresholds.ts。
 *
 * 读取失败（无记录/解密失败/DB 异常）一律返回 null，永不抛错：
 * 调用方把 null 理解为"用户未配置"，走免费数据源兜底。
 */
import type { PrismaClient } from "@adlinklab/database";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";

/** 读取加密存储的流量数据源密钥；无配置或解密失败 → null（不抛错）。 */
export async function readEncryptedTrafficSetting(
  prisma: PrismaClient,
  key: string
): Promise<string | null> {
  try {
    const row = await prisma.aiSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const raw = row?.value?.trim();
    if (!raw) return null;
    const pepper = assertAiSettingsPepperConfigured();
    return decryptSecret(raw, pepper);
  } catch {
    return null;
  }
}
