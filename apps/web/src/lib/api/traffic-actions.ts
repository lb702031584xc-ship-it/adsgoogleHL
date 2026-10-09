"use server";

/**
 * 流量需求门（traffic gate）server actions.
 *
 * 后端契约：POST /api/v1/traffic/gate
 *   body: { brand?: string, domain?: string, keywords?: string[], geo?: string }
 *   返回 TrafficGate { passed, reason, officialSite, signals }
 * 只做检测展示，不落库。客户端组件通过这里调用，避免 import server-only 模块。
 */
import { redirect } from "next/navigation";
import { getApiBaseUrl } from "./entities-config";
import { sessionHeaders } from "./session";
import type { TrafficGate } from "./amazon-types";

export interface TrafficGateInput {
  brand?: string;
  domain?: string;
  keywords?: string[];
  geo?: string;
}

export type TrafficGateActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): { ok: false; error: string } {
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function checkTrafficGateAction(
  input: TrafficGateInput
): Promise<TrafficGateActionResult<TrafficGate>> {
  const base = getApiBaseUrl();
  const authHeaders = await sessionHeaders();
  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/traffic/gate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "网络请求失败，请稍后重试。" };
  }
  if (res.status === 401) redirect("/login");
  if (!res.ok) {
    let message = `检测失败（${res.status}）`;
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string;
      };
      message = body.message ?? body.error ?? message;
    } catch {
      /* ignore */
    }
    return { ok: false, error: message };
  }
  try {
    const data = (await res.json()) as TrafficGate;
    return { ok: true, data };
  } catch (e) {
    return mapError(e, "检测结果解析失败。");
  }
}
