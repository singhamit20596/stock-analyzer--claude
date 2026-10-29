// Entry point for every /api/* request. The logic is in cloud/lib/api.ts.
import type { Config } from "@netlify/functions";
import envelope from "../../cloud/data/snapshot.json";
import { decryptSnapshot, type Envelope, type Snapshot } from "../../cloud/lib/snapshot.ts";
import { handle } from "../../cloud/lib/api.ts";

// Decrypted once per function instance; the data only changes with a deploy.
let loaded: { snapshot: Snapshot | null; error?: string } | undefined;
function data() {
  if (!loaded) {
    try {
      loaded = { snapshot: decryptSnapshot(envelope as Envelope, process.env.DATA_KEY) };
    } catch (error) {
      loaded = { snapshot: null, error: (error as Error).message };
    }
  }
  return loaded;
}

export default (req: Request) => handle(req, data(), process.env.DATA_KEY ?? "");

export const config: Config = { path: "/api/*" };
