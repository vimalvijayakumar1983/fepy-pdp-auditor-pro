import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.urls) || !body.urls.length || body.urls.length > 100 || body.urls.some((url: unknown) => typeof url !== "string" || url.length > 2000)) return Response.json({ error: "Send 1–100 FEPY product URLs." }, { status: 400 });
  return workerRequest("/live-jobs", { method: "POST", body: JSON.stringify({urls: body.urls, decisions: body.decisions === true, embeddings: body.embeddings === true}) });
}
