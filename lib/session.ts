const encoder = new TextEncoder();
export const COOKIE = "fepy-workspace-session";
export function authConfigured() {
  return (
    (process.env.AUDITOR_APP_PASSWORD?.length || 0) >= 16 &&
    (process.env.AUDITOR_SESSION_SECRET?.length || 0) >= 32
  );
}
async function signature(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(process.env.AUDITOR_SESSION_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function createSession() {
  const expires = String(Math.floor(Date.now() / 1000) + 12 * 60 * 60);
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
  const payload = `${expires}.${nonce}`;
  return `${payload}.${await signature(payload)}`;
}
export async function validSession(value?: string) {
  if (
    !authConfigured() ||
    !value ||
    !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)
  )
    return false;
  const [expiry, nonce, sig] = value.split(".");
  const now = Math.floor(Date.now() / 1000);
  if (Number(expiry) <= now || Number(expiry) > now + 12 * 60 * 60)
    return false;
  const expected = await signature(`${expiry}.${nonce}`);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return mismatch === 0;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    return (
      ["https:", "http:"].includes(parsed.protocol) &&
      parsed.host === host &&
      parsed.origin === origin
    );
  } catch {
    return false;
  }
}
export function secureRequest(request: Request) {
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}
