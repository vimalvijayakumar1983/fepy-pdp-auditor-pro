import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
const allowed =
  /^(projects|projects\/[a-f0-9]{32}(?:\/(?:products|audits|export))?|products\/[a-f0-9]{32}(?:\/drafts|\/findings\/[a-f0-9]{20})?)$/;
async function proxy(
  request: Request,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join("/");
  if (!allowed.test(path))
    return Response.json(
      { error: "Unknown workspace endpoint." },
      { status: 404 },
    );
  let body: string | undefined;
  if (request.method !== "GET") {
    body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 4 * 1024 * 1024)
      return Response.json(
        { error: "Use an import smaller than 4 MB." },
        { status: 413 },
      );
    try {
      JSON.parse(body);
    } catch {
      return Response.json({ error: "Send valid JSON." }, { status: 400 });
    }
  }
  return workerRequest(`/workspace/${path}`, { method: request.method, body });
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
