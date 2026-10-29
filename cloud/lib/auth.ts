// Website login, against the users the laptop published.
//
// Passwords are checked with the same PBKDF2 hashes the laptop stores
// (backend/services/auth_engine.py), so the website password is the laptop
// password. Registration is closed: accounts are created on the laptop only.
//
// Sessions are signed tokens rather than rows, because the site has no
// database to keep them in. A token carries the user id, an expiry and a
// fingerprint of the password hash, so changing the password on the laptop
// signs out every website session once the change is published.
import { createHash, createHmac, pbkdf2, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Row, Snapshot } from "./snapshot.ts";

const pbkdf2Async = promisify(pbkdf2);
export const SESSION_DAYS = 30;

export interface User {
  id: string;
  username: string;
  role: string;
  password_hash: string;
  created_at: string;
}

export const users = (snapshot: Snapshot) => (snapshot.tables.users ?? []) as unknown as User[];

export function findUser(snapshot: Snapshot, username: string): User | undefined {
  // Same rule as the laptop's find_user: trimmed and lower-cased.
  const wanted = (username ?? "").trim().toLowerCase();
  return users(snapshot).find((u) => u.username === wanted);
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = (encoded ?? "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const [, iterations, saltHex, digestHex] = parts;
  const expected = Buffer.from(digestHex, "hex");
  const actual = await pbkdf2Async(
    Buffer.from(password ?? "", "utf-8"), Buffer.from(saltHex, "hex"), Number(iterations),
    expected.length, "sha256");
  return expected.length > 0 && timingSafeEqual(expected, actual);
}

// A hash of nothing in particular, verified when the username is unknown so
// that a wrong name and a wrong password take the same time to reject.
const DECOY = "pbkdf2_sha256$600000$" + "00".repeat(16) + "$" + "00".repeat(32);

/** The matching user, or null — mirrors auth_engine.authenticate. */
export async function authenticate(snapshot: Snapshot, username: string, password: string): Promise<User | null> {
  const user = findUser(snapshot, username);
  const ok = await verifyPassword(password ?? "", user ? user.password_hash : DECOY);
  return user && ok ? user : null;
}

// A key for signing sessions, derived from DATA_KEY so there is one secret to
// manage, but distinct from it so a session signature reveals nothing about it.
const signingKey = (dataKey: string) =>
  createHmac("sha256", Buffer.from(dataKey, "base64")).update("website-session-v1").digest();

const fingerprint = (user: User) =>
  createHash("sha256").update(user.password_hash).digest("base64url").slice(0, 16);

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function issueToken(user: User, dataKey: string, now = Date.now()) {
  const expires = new Date(now + SESSION_DAYS * 86_400_000);
  const payload = b64(JSON.stringify({ uid: user.id, exp: Math.floor(expires.getTime() / 1000), fp: fingerprint(user) }));
  const signature = b64(createHmac("sha256", signingKey(dataKey)).update(payload).digest());
  return { token: `${payload}.${signature}`, expires_at: expires.toISOString() };
}

/** The user this token belongs to, if it is genuine, unexpired and current. */
export function resolveToken(snapshot: Snapshot, token: string | null, dataKey: string, now = Date.now()): User | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = createHmac("sha256", signingKey(dataKey)).update(payload).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: { uid?: string; exp?: number; fp?: string };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }
  if (!claims.exp || claims.exp * 1000 < now) return null;
  const user = users(snapshot).find((u) => u.id === claims.uid);
  if (!user || claims.fp !== fingerprint(user)) return null;
  return user;
}

export const publicUser = (u: User | Row) => ({ id: u.id, username: u.username, role: u.role });
