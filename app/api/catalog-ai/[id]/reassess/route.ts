import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.id)) return Response.json({error:"Invalid audit ID."},{status:400});
  const body = await request.json().catch(()=>null);
  if (!body || !Array.isArray(body.referenceUrls) || body.referenceUrls.length>2 || body.referenceUrls.some((x:unknown)=>typeof x!=="string")) return Response.json({error:"Supply up to two manufacturer PDF URLs."},{status:400});
  return workerRequest(`/jobs/${params.id}/reassess`, {method:"POST", body:JSON.stringify(body)});
}
