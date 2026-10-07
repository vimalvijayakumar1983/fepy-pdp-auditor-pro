import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function GET() { return workerRequest("/capabilities"); }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows) || !body.rows.length || body.rows.length > 500) {
    return Response.json({ error: "Send 1–500 rows per AI audit." }, { status: 400 });
  }
  if (!body.decisions && !body.embeddings) return Response.json({ error: "Select at least one AI check." }, { status: 400 });
  return workerRequest("/jobs", { method: "POST", body: JSON.stringify(body) });
}
