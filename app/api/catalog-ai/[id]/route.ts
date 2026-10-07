import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.id)) return Response.json({ error: "Invalid audit ID." }, { status: 400 });
  return workerRequest(`/jobs/${params.id}`);
}
