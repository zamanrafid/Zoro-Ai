"use client";

/** fetch with a hard timeout so requests can never hang silently forever. */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30000
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // non-JSON (gateway errors etc.) — keep status for the message below
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. The server may be waking up or overloaded — please retry.`);
    }
    throw new Error(`Network error: ${e instanceof Error ? e.message : "could not reach the server"}. Check your connection and retry.`);
  } finally {
    clearTimeout(t);
  }
}

export function apiError(status: number, data: Record<string, unknown>, fallback: string): string {
  const msg = typeof data.error === "string" && data.error ? data.error : fallback;
  return status ? `${msg} (HTTP ${status})` : msg;
}
