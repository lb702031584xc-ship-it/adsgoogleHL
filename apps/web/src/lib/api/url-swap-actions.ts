"use server";

import {
  UrlSwapApiError,
  createUrlSwapTask,
  deleteUrlSwapTask,
  getUrlSwapScript,
  getUrlSwapTask,
  listUrlSwapTasks,
  regenerateUrlSwapAuth,
  runUrlSwapTask,
  updateUrlSwapTask,
  type UrlSwapTaskInput,
} from "./url-swap";

export type UrlSwapActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function mapError(e: unknown, fallback: string): UrlSwapActionResult<never> {
  if (e instanceof UrlSwapApiError) {
    return { ok: false, error: e.message || fallback };
  }
  return {
    ok: false,
    error: e instanceof Error && e.message ? e.message : fallback,
  };
}

export async function listUrlSwapTasksAction(summary = true) {
  try {
    const res = await listUrlSwapTasks({ summary });
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "加载换链任务失败");
  }
}

export async function getUrlSwapTaskAction(id: string) {
  try {
    const res = await getUrlSwapTask(id);
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "加载任务失败");
  }
}

export async function createUrlSwapTaskAction(input: UrlSwapTaskInput) {
  try {
    const res = await createUrlSwapTask(input);
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "创建失败");
  }
}

export async function updateUrlSwapTaskAction(
  id: string,
  patch: Partial<UrlSwapTaskInput>
) {
  try {
    const res = await updateUrlSwapTask(id, patch);
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "更新失败");
  }
}

export async function deleteUrlSwapTaskAction(id: string) {
  try {
    await deleteUrlSwapTask(id);
    return { ok: true as const, data: { ok: true } };
  } catch (e) {
    return mapError(e, "删除失败");
  }
}

export async function runUrlSwapTaskAction(id: string) {
  try {
    const res = await runUrlSwapTask(id, true);
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "执行失败");
  }
}

export async function getUrlSwapScriptAction() {
  try {
    const res = await getUrlSwapScript();
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "加载脚本失败");
  }
}

export async function regenerateUrlSwapAuthAction() {
  try {
    const res = await regenerateUrlSwapAuth();
    return { ok: true as const, data: res.data };
  } catch (e) {
    return mapError(e, "重置失败");
  }
}
