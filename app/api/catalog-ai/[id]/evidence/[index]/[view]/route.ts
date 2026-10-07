export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: { id: string; index: string; view: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.id) || !/^\d{1,2}$/.test(params.index) || !["desktop", "mobile"].includes(params.view)) return Response.json({error: "Invalid evidence."}, {status: 400});
  const base = process.env.AUDITOR_WORKER_URL, token = process.env.AUDITOR_WORKER_TOKEN;
  if (!base || !token) return Response.json({error: "Worker unavailable."}, {status: 503});
  try {
    const response = await fetch(new URL(`/jobs/${params.id}/evidence/${params.index}/${params.view}`, base), {headers: {Authorization: `Bearer ${token}`}, cache: "no-store", signal: AbortSignal.timeout(20000)});
    if (!response.ok) return Response.json({error: "Evidence unavailable or expired."}, {status: response.status});
    return new Response(await response.arrayBuffer(), {headers: {"Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}});
  } catch { return Response.json({error: "Worker could not be reached."}, {status: 502}); }
}
