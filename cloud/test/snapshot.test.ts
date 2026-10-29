// The website must read exactly what the laptop wrote. fixture.json was
// produced by backend/services/cloud_publish.py with a test-only key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decryptSnapshot } from "../lib/snapshot.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf-8"));

test("decrypts what Python encrypted, value for value", () => {
  const snapshot = decryptSnapshot(fixture.envelope, fixture.key)!;
  assert.deepEqual(snapshot.tables, fixture.expected);
  assert.equal(snapshot.published_at, "2026-10-29T11:00:00+00:00");
  assert.equal(snapshot.row_counts.users, 1);
});

test("a wrong key is refused, not misread", () => {
  assert.throws(() => decryptSnapshot(fixture.envelope, Buffer.alloc(32, 9).toString("base64")));
});

test("a tampered file is refused", () => {
  const sealed = Buffer.from(fixture.envelope.ciphertext, "base64");
  sealed[5] ^= 1;
  assert.throws(() => decryptSnapshot({ ...fixture.envelope, ciphertext: sealed.toString("base64") }, fixture.key));
});

test("the placeholder means nothing published yet", () => {
  // What cloud/data/snapshot.json holds before the laptop's first publish.
  const placeholder = { format: "stocks-analyzer-snapshot", version: 1, empty: true };
  assert.equal(decryptSnapshot(placeholder, undefined), null);
});

test("a missing key is reported", () => {
  assert.throws(() => decryptSnapshot(fixture.envelope, undefined), /DATA_KEY is not set/);
});
