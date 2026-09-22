export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(responseInit.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...responseInit, headers });
}

export function ok(data: unknown = {}): Response {
  return json({ success: true, data });
}

export function fail(message: string, status = 400): Response {
  return json({ success: false, error: message }, status);
}

export function unauthorized(): Response {
  return json({ success: false, error: "未登录或会话已过期" }, 401);
}

export function forbidden(message = "无权限：请先解锁编辑模式"): Response {
  return json({ success: false, error: message }, 403);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
}
