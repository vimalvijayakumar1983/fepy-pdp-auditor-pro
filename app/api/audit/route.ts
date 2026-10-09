// The legacy extractor invented fallback specifications and skipped the site gate.
// Keep a clear migration response instead of exposing a second network audit path.
export const dynamic = "force-dynamic";
function retired() {
  return Response.json(
    {
      error:
        "This legacy extraction endpoint has been retired. Use an authorized live audit in the workspace, or import catalog fields.",
      workspace: "/workspace",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export const POST = retired;
export const GET = retired;
