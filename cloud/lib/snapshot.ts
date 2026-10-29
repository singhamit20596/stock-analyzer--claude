// Reads the laptop's published data (cloud/data/snapshot.json).
//
// The file is in a public repository, so it is AES-256-GCM encrypted by the
// laptop (backend/services/cloud_publish.py) and decrypted here with the
// DATA_KEY environment variable. GCM authenticates: a wrong key or an altered
// file throws rather than yielding garbage.
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const FORMAT = "stocks-analyzer-snapshot";
export const VERSION = 1;
const AAD = Buffer.from(`${FORMAT}-v${VERSION}`);
const TAG_BYTES = 16;

export type Row = Record<string, string | number | null>;

export interface Snapshot {
  published_at: string;
  source: string;
  row_counts: Record<string, number>;
  tables: Record<string, Row[]>;
}

export interface Envelope {
  format: string;
  version: number;
  empty?: boolean;
  nonce?: string;
  ciphertext?: string;
}

/** The snapshot, or null when the laptop has not published anything yet. */
export function decryptSnapshot(envelope: Envelope, keyBase64: string | undefined): Snapshot | null {
  if (envelope.format !== FORMAT || envelope.version !== VERSION) {
    throw new Error("data file is not a version-1 snapshot");
  }
  if (envelope.empty) return null;
  if (!keyBase64) throw new Error("DATA_KEY is not set");

  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("DATA_KEY must be 32 bytes, base64-encoded");

  const sealed = Buffer.from(envelope.ciphertext ?? "", "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce ?? "", "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  return JSON.parse(gunzipSync(plain).toString("utf-8")) as Snapshot;
}
