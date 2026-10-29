// Whether this deploy can read the laptop's published data. Reports only the
// state and when it was published, never any of the data.
import type { Config } from "@netlify/functions";
import envelope from "../../cloud/data/snapshot.json";
import { decryptSnapshot, type Envelope } from "../../cloud/lib/snapshot.ts";

export default async () => {
  let body: Record<string, unknown>;
  try {
    const snapshot = decryptSnapshot(envelope as Envelope, Netlify.env.get("DATA_KEY"));
    body = snapshot
      ? { data: "loaded", published_at: snapshot.published_at }
      : { data: "nothing published yet" };
  } catch (error) {
    body = { data: "unreadable", reason: (error as Error).message };
  }
  return Response.json(body, { headers: { "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/health" };
