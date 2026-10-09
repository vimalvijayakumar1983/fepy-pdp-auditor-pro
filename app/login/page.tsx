import { authConfigured } from "@/lib/session";
import Login from "./Login";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Login configured={authConfigured()} />;
}
