/**
 * AdsPower Local API client.
 *
 * AdsPower 是指纹浏览器管理工具，本客户端只做两件事：
 *   1. 列出浏览器环境（listProfiles）
 *   2. 拉起 / 关闭浏览器（openBrowser / closeBrowser），辅助用户**手动**操作
 *
 * 范围声明：绝不自动操作任何第三方网站 —— 没有表单填写、没有点击、
 * 没有登录脚本。浏览器拉起后完全由用户手动接管。
 *
 * Local API 默认地址 http://localhost:50325（环境变量 ADSPOWER_API_URL 可覆盖）。
 * AdsPower 未启动时返回友好的 503 错误，不会抛 500 崩溃。
 */
import { AppError } from "@adlinklab/shared";

export const ADSPOWER_DEFAULT_API_URL = "http://localhost:50325";
export const ADSPOWER_API_URL_ENV = "ADSPOWER_API_URL";

const LIST_TIMEOUT_MS = 10_000;
const OPEN_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 15_000;

export class AdsPowerError extends AppError {
  constructor(message: string, statusCode = 503) {
    super(message, { code: "ADSPOWER_ERROR", statusCode });
    this.name = "AdsPowerError";
  }
}

/** Friendly error surfaced when the AdsPower desktop app / Local API is down. */
function adspowerUnavailableError(baseUrl: string): AdsPowerError {
  return new AdsPowerError(
    `AdsPower 未启动或 Local API 不可达（${baseUrl}）。请先启动 AdsPower 桌面端，` +
      `并确认「设置 → Local API」已开启；如端口不同，请设置环境变量 ${ADSPOWER_API_URL_ENV}。`
  );
}

export interface AdsPowerProfile {
  /** AdsPower user_id（环境 ID，不透明字符串）。 */
  userId: string;
  name: string;
  groupName?: string;
  domainName?: string;
  username?: string;
  ip?: string;
  lastOpenTime?: string;
  /** Raw record passthrough for forward-compat. */
  raw?: Record<string, unknown>;
}

export interface AdsPowerBrowserSession {
  userId: string;
  debugPort?: number;
  webdriver?: string;
  seleniumWs?: string;
  puppeteerWs?: string;
}

export interface AdsPowerClientOptions {
  baseUrl?: string;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

function normalizeBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
  return trimmed || ADSPOWER_DEFAULT_API_URL;
}

export function resolveAdsPowerBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string {
  return normalizeBaseUrl(env[ADSPOWER_API_URL_ENV]);
}

/** AdsPower Local API envelope: { code: 0, msg, data }. Non-zero code = failure. */
interface AdsPowerEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
}

export class AdsPowerClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AdsPowerClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Build a client from the environment (ADSPOWER_API_URL, default :50325). */
  static fromEnv(
    env: NodeJS.ProcessEnv = process.env,
    fetchImpl?: typeof fetch
  ): AdsPowerClient {
    return new AdsPowerClient({
      baseUrl: resolveAdsPowerBaseUrl(env),
      fetchImpl,
    });
  }

  private async get<T>(
    path: string,
    query: Record<string, string>,
    timeoutMs: number
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // AdsPower not running / port closed / timeout — friendly 503, not 500.
      throw adspowerUnavailableError(this.baseUrl);
    }

    if (!res.ok) {
      throw new AdsPowerError(
        `AdsPower Local API 请求失败（HTTP ${res.status}），请确认 AdsPower 已启动且 Local API 正常。`,
        502
      );
    }

    let envelope: AdsPowerEnvelope<T>;
    try {
      envelope = (await res.json()) as AdsPowerEnvelope<T>;
    } catch {
      throw new AdsPowerError(
        "AdsPower Local API 返回了无法解析的响应，请确认连接的是 AdsPower Local API。",
        502
      );
    }

    if (typeof envelope.code === "number" && envelope.code !== 0) {
      throw new AdsPowerError(
        `AdsPower 返回错误：${envelope.msg || `code=${envelope.code}`}。`,
        502
      );
    }
    return envelope.data as T;
  }

  /**
   * List browser environments (GET /api/v1/user/list).
   * Read-only helper for the user to pick an environment — no automation.
   */
  async listProfiles(): Promise<AdsPowerProfile[]> {
    const data = await this.get<{ list?: Array<Record<string, unknown>> }>(
      "/api/v1/user/list",
      {},
      LIST_TIMEOUT_MS
    );
    const list = data?.list ?? [];
    return list.map((p) => ({
      userId: String(p.user_id ?? p.id ?? ""),
      name: String(p.name ?? p.user_id ?? ""),
      groupName: p.group_name != null ? String(p.group_name) : undefined,
      domainName: p.domain_name != null ? String(p.domain_name) : undefined,
      username: p.username != null ? String(p.username) : undefined,
      ip: p.ip != null ? String(p.ip) : undefined,
      lastOpenTime:
        p.last_open_time != null ? String(p.last_open_time) : undefined,
      raw: p,
    }));
  }

  /**
   * Open a browser for the given environment (GET /api/v1/browser/start).
   * The browser is handed to the USER to operate manually — this client
   * never drives pages, fills forms, or clicks anything.
   */
  async openBrowser(profileId: string): Promise<AdsPowerBrowserSession> {
    const id = profileId.trim();
    if (!id) throw new AdsPowerError("profileId 不能为空。", 400);
    const data = await this.get<{
      debug_port?: number | string;
      webdriver?: string;
      ws?: { selenium?: string; puppeteer?: string };
    }>("/api/v1/browser/start", { user_id: id }, OPEN_TIMEOUT_MS);
    const debugPort =
      data?.debug_port != null ? Number(data.debug_port) : undefined;
    return {
      userId: id,
      debugPort: Number.isFinite(debugPort) ? debugPort : undefined,
      webdriver: data?.webdriver,
      seleniumWs: data?.ws?.selenium,
      puppeteerWs: data?.ws?.puppeteer,
    };
  }

  /** Close the browser for the given environment (GET /api/v1/browser/stop). */
  async closeBrowser(profileId: string): Promise<void> {
    const id = profileId.trim();
    if (!id) throw new AdsPowerError("profileId 不能为空。", 400);
    await this.get("/api/v1/browser/stop", { user_id: id }, CLOSE_TIMEOUT_MS);
  }
}
