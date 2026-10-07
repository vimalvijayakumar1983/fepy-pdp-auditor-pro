import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function GET() { return workerRequest("/browser-sessions"); }
export async function POST() { return workerRequest("/browser-sessions", { method: "POST" }); }
