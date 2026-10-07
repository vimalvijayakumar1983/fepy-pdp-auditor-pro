
export async function workerRequest(path: string, init: RequestInit = {}) {
  const base = process.env.AUDITOR_WORKER_URL;
  const token = process.env.AUDITOR_WORKER_TOKEN;
  if (!base || !token) return Response.json({ error: "AI worker is not configured. Set AUDITOR_WORKER_URL and AUDITOR_WORKER_TOKEN on the app." }, { status: 503 });
  try {
    const response = await fetch(new URL(path, base), {
      ...init, cache: "no-store", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers },
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch {
    return Response.json({ error: "The AI worker could not be reached. Please retry." }, { status: 502 });
  }
}
