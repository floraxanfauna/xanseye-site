"use client";

export class ApiError extends Error { constructor(message: string, public code?: string, public body?: any) { super(message); } }

export async function api<T = any>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/admin/${path}`, {
    method, cache: "no-store",
    headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.location.href = "/admin/login"; throw new ApiError("Please sign in"); }
  if (!r.ok) throw new ApiError(j.error || "Something went wrong", j.code, j);
  return j as T;
}
