// The website's API; netlify/functions/api.mts is the entry point. Read-only:
// the laptop is the only place anything is written, so every write is refused
// here regardless of what the UI shows.
import { getStore } from "@netlify/blobs";
import type { Snapshot } from "./snapshot.ts";
import { authenticate, issueToken, publicUser, resolveToken, users } from "./auth.ts";
import * as pages from "./pages.ts";
import { liveQuotes, type Quotes } from "./quotes.ts";
import { Store } from "./store.ts";

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

export async function handle(req: Request, { snapshot, error }: { snapshot: Snapshot | null; error?: string }, key: string,
                             quotes: Quotes = liveQuotes) {
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

  if (/^\/api\/(chat|portfolios\/[^/]+\/news|stock\/[^/]+\/news)$/.test(path)) {
    return detail("News and the assistant are only in the laptop app for now.", 403);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return detail("The website is read-only. Make changes in the laptop app.", 403);
  }

  if (path === "/api/auth/me") {
    const others = account.role === "admin"
      ? [...users(snapshot)].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(publicUser)
      : [];
    return json({ ...publicUser(account), users: others });
  }

  // main.viewer: an admin may look at another user's data, read-only.
  const store = new Store(snapshot);
  const viewAs = req.headers.get("x-view-as");
  let target = store.user(account.id)!;
  if (viewAs && viewAs !== account.id) {
    if (account.role !== "admin") return detail("Only an admin can view other users.", 403);
    const other = store.user(viewAs);
    if (!other) return detail("No such user.", 404);
    target = other;
  }
  const ctx: pages.Ctx = { store, quotes, view: { account: store.user(account.id)!, user: target, impersonating: target.id !== account.id } };

  try {
    const result = await route(ctx, path, new URL(req.url).searchParams);
    if (result === undefined) return detail("This part of the app isn't on the website yet.", 501);
    return json(result);
  } catch (error) {
    if (error instanceof pages.HttpError) return detail(error.message, error.status);
    console.error(error);
    return detail("Something went wrong on the website.", 500);
  }
}

/** FastAPI's Query(default, ge, le) for an integer parameter. */
function intParam(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new pages.HttpError(422, `${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

async function route(ctx: pages.Ctx, path: string, params: URLSearchParams): Promise<unknown> {
  const parts = path.split("/").slice(2).map(decodeURIComponent);   // after "/api"
  const [a, b, c, ...rest] = parts;
  if (rest.length) return undefined;

  if (a === "accounts") {
    if (b === undefined) return pages.listAccounts(ctx);
    if (c === "detail") return pages.accountDetail(ctx, b);
    if (c === "changes") return pages.accountChanges(ctx, b, intParam(params, "limit", 100, 1, 500));
    if (c === "screenshot") throw new pages.HttpError(404, "Screenshots stay on the laptop.");
  }
  if (a === "portfolios") {
    if (b === undefined) return pages.listPortfolios(ctx);
    if (c === "detail") return pages.portfolioDetail(ctx, b);
  }
  if (a === "classification" && b === undefined) return pages.classification(ctx);
  if (a === "targets") {
    if (b === undefined) return pages.listTargets(ctx);
    if (c === "compare") {
      const portfolioId = params.get("portfolio_id");
      if (!portfolioId) throw new pages.HttpError(422, "portfolio_id is required.");
      return pages.compareTargetPage(ctx, b, portfolioId);
    }
  }
  if (a === "sync-logs" && b === undefined) return pages.syncLogs(ctx);
  return undefined;
}
