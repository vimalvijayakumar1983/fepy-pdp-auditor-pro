import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
function valid(id: string) { return /^[a-f0-9]{32}$/.test(id); }
export async function GET(_: Request, {params}: {params: {id: string}}) {
  if (!valid(params.id)) return Response.json({error:"Browser session not found."}, {status:404});
  return workerRequest(`/browser-sessions/${params.id}`);
}
export async function DELETE(_: Request, {params}: {params: {id: string}}) {
  if (!valid(params.id)) return Response.json({error:"Browser session not found."}, {status:404});
  return workerRequest(`/browser-sessions/${params.id}`, {method:"DELETE"});
}
