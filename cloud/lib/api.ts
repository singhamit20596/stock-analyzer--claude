// The website's API; netlify/functions/api.mts is the entry point. Read-only:
// the laptop is the only place anything is written, so every write is refused
// here regardless of what the UI shows.
import { getStore } from "@netlify/blobs";
import type { Snapshot } from "./snapshot.ts";
import { authenticate, issueToken, publicUser, resolveToken, users } from "./auth.ts";

// Failed logins allowed per username in the window, before refusing.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
const detail = (message: string, status: number) => json({ detail: message }, status);

const bearer = (req: Request) => {
  const [scheme, token] = (req.headers.get("authorization") ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
};

// Rate limiting needs somewhere to count, and Blobs is it. If Blobs is
// unavailable the login still works (PBKDF2 keeps guessing slow regardless).
async function failures(username: string): Promise<number[]> {
  try {
    const recent = (await getStore("login-failures").get(username, { type: "json" })) as number[] | null;
    return (recent ?? []).filter((t) => t > Date.now() - WINDOW_MS);
  } catch {
    return [];
  }
}
async function recordFailure(username: string, recent: number[]) {
  try {
    await getStore("login-failures").setJSON(username, [...recent, Date.now()].slice(-MAX_FAILURES));
  } catch {
    /* see failures() */
  }
}

export async function handle(req: Request, { snapshot, error }: { snapshot: Snapshot | null; error?: string }, key: string) {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");

  if (path === "/api/health") {
    if (error) return json({ data: "unreadable", reason: error });
    return json(snapshot ? { data: "loaded", published_at: snapshot.published_at } : { data: "nothing published yet" });
  }

  if (!snapshot) {
    return detail(error ? "The website can't read its data right now." : "Nothing has been published from the laptop yet.", 503);
  }

  if (path === "/api/auth/status" && req.method === "GET") {
    return json({ has_users: users(snapshot).length > 0 });
  }

  if (path === "/api/auth/register") {
    return detail("Accounts are created in the laptop app. Sign in here with the same username and password.", 403);
  }

  if (path === "/api/auth/login" && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
    const name = (body.username ?? "").trim().toLowerCase();
    const recent = await failures(name);
    if (recent.length >= MAX_FAILURES) {
      return detail("Too many failed attempts. Try again in 15 minutes.", 429);
    }
    const user = await authenticate(snapshot, body.username ?? "", body.password ?? "");
    if (!user) {
      await recordFailure(name, recent);
      return detail("Incorrect username or password.", 401);
    }
    return json({ ...issueToken(user, key), user: publicUser(user) });
  }

  if (path === "/api/auth/logout") {
    // Nothing is stored server-side; the browser forgetting the token is the sign-out.
    return json({ message: "Signed out." });
  }

  const account = resolveToken(snapshot, bearer(req), key);
  if (!account) return detail("Sign in to continue.", 401);

  if (req.method !== "GET" && req.method !== "HEAD") {
    return detail("The website is read-only. Make changes in the laptop app.", 403);
  }

  if (path === "/api/auth/me") {
    const others = account.role === "admin"
      ? [...users(snapshot)].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(publicUser)
      : [];
    return json({ ...publicUser(account), users: others });
  }

  return detail("This part of the app isn't on the website yet.", 501);
}

