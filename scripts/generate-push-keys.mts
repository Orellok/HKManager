/**
 * Generates the VAPID key pair for Web Push (M7.2-11) with Node built-ins only, for one
 * environment, and writes it to a git-ignored env file readable by the owner only, ready for
 * `supabase secrets set --env-file`. The private key is never printed; only the public key
 * (which goes into the browser bundle anyway) and the next steps are. docs/setup/push.md.
 *
 * Usage: node scripts/generate-push-keys.mts <staging|production> [--force]
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeOwnerOnlyFile } from "./owner-only-file.mts";

export const ENVIRONMENTS = {
  staging: { subject: "https://hkmanager-staging.netlify.app", projectRef: "tmistmqyqcnjftovxyoy" },
  production: { subject: "https://hkmanager.netlify.app", projectRef: "gnjdyiujvxbwhxmldgfn" },
} as const;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

export type VapidKeyPair = { publicKey: string; privateKey: string };

/** A P-256 key pair as base64url: the uncompressed public point and the private scalar. */
export function generateVapidKeys(): VapidKeyPair {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.d || !jwk.x || !jwk.y) {
    throw new Error("Unexpected key export");
  }
  const point = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}

export function renderEnvFile(keys: VapidKeyPair, subject: string): string {
  return [
    "# Web Push VAPID keys (M7.2). Secret: never commit, never paste into a chat.",
    "# Load with: pnpm exec supabase secrets set --env-file <this file> --remote=<ref> --yes",
    `VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    `VAPID_SUBJECT=${subject}`,
    "",
  ].join("\n");
}

export function envFilePath(environment: EnvironmentName): string {
  return fileURLToPath(new URL(`../supabase/.env.push.${environment}.local`, import.meta.url));
}

function main(args: string[]): number {
  const environment = args[0];
  if (environment !== "staging" && environment !== "production") {
    console.error("Usage: node scripts/generate-push-keys.mts <staging|production> [--force]");
    return 2;
  }
  const file = envFilePath(environment);
  if (existsSync(file) && !args.includes("--force")) {
    console.error(
      `${file} already exists. New keys make every device turn notifications on again; ` +
        "pass --force to replace them.",
    );
    return 1;
  }
  const { subject, projectRef } = ENVIRONMENTS[environment];
  const keys = generateVapidKeys();
  writeOwnerOnlyFile(file, renderEnvFile(keys, subject));
  console.log(`Wrote ${file} (owner-only). The private key is only in that file.`);
  console.log("");
  console.log(`Public key (not secret): ${keys.publicKey}`);
  console.log("");
  console.log("Next steps (docs/setup/push.md):");
  console.log(`1. pnpm exec supabase secrets set --env-file ${file} --remote=${projectRef} --yes`);
  console.log(
    `2. GitHub repository variable ${environment.toUpperCase()}_NEXT_PUBLIC_VAPID_PUBLIC_KEY = the public key above; then redeploy.`,
  );
  console.log("3. Keep the file somewhere safe (password manager) or delete it.");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
