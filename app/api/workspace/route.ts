import { workerRequest } from "@/lib/worker";
export const dynamic = "force-dynamic";
export async function GET() {
  return workerRequest("/workspace");
}
