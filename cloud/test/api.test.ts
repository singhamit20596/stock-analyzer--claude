// Website login against laptop-made password hashes. HASH was produced by
// backend/services/auth_engine.hash_password("correct-horse-1"), test only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../lib/api.ts";
import { issueToken, type User } from "../lib/auth.ts";
import type { Snapshot } from "../lib/snapshot.ts";

const HASH = "pbkdf2_sha256$600000$8b44756dcf89a2268274947e74c03999$479d6d1587086c422b8c6555e1802d7afe95e3198ee41f686ec2e9dc0d5105a4";
const KEY = Buffer.alloc(32, 7).toString("base64");
const admin = { id: "u1", username: "owner", password_hash: HASH, role: "admin", created_at: "2026-08-06 16:43:24" };
const member = { id: "u2", username: "member", password_hash: HASH, role: "user", created_at: "2026-09-01 10:00:00" };
const snapshot: Snapshot = { published_at: "2026-10-29T11:00:00+00:00", source: "t", row_counts: {}, tables: { users: [admin, member] } };
const loaded = { snapshot };

const call = (path: string, init: RequestInit = {}, data = loaded) =>
  handle(new Request(`https://site.test${path}`, init), data, KEY);
const login = (username: string, password: string) =>
  call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
const authed = (token: string, init: RequestInit = {}) => ({ ...init, headers: { authorization: `Bearer ${token}` } });

test("the laptop password signs in, case-insensitive username like the laptop", async () => {
  const res = await login("  Owner ", "correct-horse-1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.user, { id: "u1", username: "owner", role: "admin" });
  const me = await (await call("/api/auth/me", authed(body.token))).json();
  assert.equal(me.username, "owner");
  assert.deepEqual(me.users.map((u: User) => u.username), ["owner", "member"]);
});

test("wrong password and unknown user get the same answer", async () => {
  const a = await login("owner", "wrong-password");
  const b = await login("nobody", "correct-horse-1");
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(await a.json(), await b.json());
});

test("a non-admin sees no other users", async () => {
  const { token } = await (await login("member", "correct-horse-1")).json();
  assert.deepEqual((await (await call("/api/auth/me", authed(token))).json()).users, []);
});

test("forged, expired and stale tokens are refused", async () => {
  const { token } = await (await login("owner", "correct-horse-1")).json();
  assert.equal((await call("/api/auth/me", authed(token.slice(0, -2) + "xx"))).status, 401);
  assert.equal((await call("/api/auth/me", authed(issueToken(admin, Buffer.alloc(32, 1).toString("base64")).token))).status, 401);
  const old = issueToken(admin, KEY, Date.now() - 31 * 86_400_000).token;
  assert.equal((await call("/api/auth/me", authed(old))).status, 401);
  // Password changed on the laptop and published: old sessions end.
  const changed = { snapshot: { ...snapshot, tables: { users: [{ ...admin, password_hash: HASH.replace(/.$/, "0") }, member] } } };
  assert.equal((await call("/api/auth/me", authed(token), changed)).status, 401);
  assert.equal((await call("/api/auth/me")).status, 401);
});

test("writes are refused, even signed in; registration is closed", async () => {
  const { token } = await (await login("owner", "correct-horse-1")).json();
  assert.equal((await call("/api/portfolios", authed(token, { method: "POST" }))).status, 403);
  assert.equal((await call("/api/auth/register", { method: "POST", body: "{}" })).status, 403);
});

test("status, health, and the not-yet-built pages", async () => {
  assert.deepEqual(await (await call("/api/auth/status")).json(), { has_users: true });
  assert.equal((await (await call("/api/health")).json()).data, "loaded");
  const { token } = await (await login("owner", "correct-horse-1")).json();
  assert.equal((await call("/api/stock/AAPL/analysis", authed(token))).status, 501);
  assert.deepEqual(await (await call("/api/accounts", authed(token))).json(), []);
  assert.equal((await call("/api/auth/status", {}, { snapshot: null })).status, 503);
});
