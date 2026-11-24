/**
 * One-time owner step (M7.3-8, docs/setup/backups.md): Google consent for the backup OAuth
 * client (Desktop app) through a loopback redirect, then the refresh token is written to a
 * git-ignored, owner-only file for GitHub Secrets. The token is never printed.
 *
 * Usage: node scripts/backup/get-drive-token.mts <client_secret_….json> [--force]
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

import { writeOwnerOnlyFile } from "../owner-only-file.mts";

import { BackupError, describeUnexpected } from "./backup-error.mts";
import {
  BACKUP_FOLDER_NAME,
  createDriveClient,
  DRIVE_SCOPE,
  requestToken,
  type Fetch,
} from "./google-drive.mts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LOOPBACK_HOST = "127.0.0.1";
export const CONSENT_TIMEOUT_MS = 5 * 60_000;
export const TOKEN_FILE = fileURLToPath(new URL("../../.env.drive-backup.local", import.meta.url));

export type OAuthClient = { clientId: string; clientSecret: string };

/** The JSON Google offers for a Desktop app client ("installed"). */
export function parseClientFile(text: string): OAuthClient {
  let json: { installed?: { client_id?: unknown; client_secret?: unknown }; web?: unknown };
  try {
    json = JSON.parse(text);
  } catch {
    throw new BackupError("The client file is not JSON (download it again from Google Cloud)");
  }
  if (!json.installed && json.web) {
    throw new BackupError("This is a Web application client; create a Desktop app client");
  }
  const clientId = json.installed?.client_id;
  const clientSecret = json.installed?.client_secret;
  if (typeof clientId !== "string" || !clientId.endsWith(".apps.googleusercontent.com")) {
    throw new BackupError("The client file has no Desktop app client_id");
  }
  if (typeof clientSecret !== "string" || clientSecret === "") {
    throw new BackupError("The client file has no client_secret");
  }
  return { clientId, clientSecret };
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function buildConsentUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

export function renderTokenEnvFile(client: OAuthClient, refreshToken: string): string {
  return [
    "# Google Drive backup credentials (M7.3). Secret: never commit, never paste into a chat.",
    "# Load into GitHub: gh secret set -f .env.drive-backup.local   (then delete this file)",
    `GOOGLE_DRIVE_BACKUP_CLIENT_ID=${client.clientId}`,
    `GOOGLE_DRIVE_BACKUP_CLIENT_SECRET=${client.clientSecret}`,
    `GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN=${refreshToken}`,
    "",
  ].join("\n");
}

const DONE_PAGE =
  '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>HKManager</title>' +
  "<p>ההרשאה התקבלה. אפשר לסגור את החלון ולחזור לחלון הפקודות.</p></html>";
const FAILED_PAGE =
  '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>HKManager</title>' +
  "<p>ההרשאה לא התקבלה. חזרו לחלון הפקודות.</p></html>";

/** Listens on 127.0.0.1 (random port) for Google's redirect with the code. */
export async function startLoopback(state: string, timeoutMs: number = CONSENT_TIMEOUT_MS) {
  const { promise: code, resolve, reject } = Promise.withResolvers<string>();
  // Awaited later; until then a timeout must not become an unhandled rejection.
  code.catch(() => undefined);
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    if (url.pathname !== "/") {
      response.writeHead(404).end();
      return;
    }
    const finish = (ok: boolean, outcome: string | Error) => {
      response.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      response.end(ok ? DONE_PAGE : FAILED_PAGE);
      if (ok) {
        resolve(outcome as string);
      } else {
        reject(outcome as Error);
      }
    };
    if (url.searchParams.get("state") !== state) {
      finish(
        false,
        new BackupError("The consent answer did not match this run (state); run again"),
      );
    } else if (url.searchParams.get("error")) {
      finish(false, new BackupError("Consent was not given in Google's screen; run again"));
    } else if (!url.searchParams.get("code")) {
      finish(false, new BackupError("Google's answer had no authorization code; run again"));
    } else {
      finish(true, url.searchParams.get("code") as string);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK_HOST, resolve));
  const { port } = server.address() as AddressInfo;
  const timer = setTimeout(
    () => reject(new BackupError("No consent within 5 minutes; run again")),
    timeoutMs,
  );
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };
  return { redirectUri: `http://${LOOPBACK_HOST}:${port}/`, code, close };
}

/** Code → tokens; requires a refresh token and the `drive.file` grant. */
export async function exchangeCode(
  client: OAuthClient,
  options: { code: string; redirectUri: string; verifier: string },
  fetchFn: Fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = await requestToken(fetchFn, "Google code exchange", {
    grant_type: "authorization_code",
    code: options.code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: options.redirectUri,
    code_verifier: options.verifier,
  });
  const scopes = typeof body.scope === "string" ? body.scope.split(" ") : [];
  if (!scopes.includes(DRIVE_SCOPE)) {
    throw new BackupError(
      "The Drive permission was not granted: run again and tick the Google Drive checkbox",
    );
  }
  if (typeof body.refresh_token !== "string" || body.refresh_token === "") {
    throw new BackupError("Google returned no refresh token; run again (prompt=consent)");
  }
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new BackupError("Google returned no access token; run again");
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token };
}

/** The whole flow; `showConsentUrl` prints (or, in tests, follows) the consent address. */
export async function runTokenFlow(options: {
  client: OAuthClient;
  outFile: string;
  showConsentUrl: (url: string) => void | Promise<void>;
  fetch?: Fetch;
  timeoutMs?: number;
}): Promise<void> {
  const fetchFn = options.fetch ?? fetch;
  const state = randomBytes(16).toString("base64url");
  const pkce = createPkce();
  const loopback = await startLoopback(state, options.timeoutMs);
  try {
    await options.showConsentUrl(
      buildConsentUrl({
        clientId: options.client.clientId,
        redirectUri: loopback.redirectUri,
        state,
        codeChallenge: pkce.challenge,
      }),
    );
    const code = await loopback.code;
    const tokens = await exchangeCode(
      options.client,
      { code, redirectUri: loopback.redirectUri, verifier: pkce.verifier },
      fetchFn,
    );
    writeOwnerOnlyFile(options.outFile, renderTokenEnvFile(options.client, tokens.refreshToken));
    // Proves the token, the scope and that the Drive API is enabled for the project.
    await createDriveClient(tokens.accessToken, fetchFn).findOrCreateFolder();
  } finally {
    loopback.close();
  }
}

async function main(args: string[]): Promise<number> {
  const clientFile = args.find((arg) => !arg.startsWith("--"));
  if (!clientFile) {
    console.error(
      "Usage: node scripts/backup/get-drive-token.mts <client_secret_….json> [--force]",
    );
    return 2;
  }
  if (existsSync(TOKEN_FILE) && !args.includes("--force")) {
    console.error(
      `${TOKEN_FILE} already exists. Each run creates a new token; pass --force to replace it.`,
    );
    return 1;
  }
  const client = parseClientFile(readFileSync(clientFile, "utf8"));
  await runTokenFlow({
    client,
    outFile: TOKEN_FILE,
    showConsentUrl: (url) => {
      console.log("Open this address in a browser signed in to the business Google account:");
      console.log("");
      console.log(url);
      console.log("");
      console.log("Waiting for the consent (up to 5 minutes)…");
    },
  });
  console.log("");
  console.log(`Wrote ${TOKEN_FILE} (readable by you only). The token is only in that file.`);
  console.log(`Google Drive check: OK (folder "${BACKUP_FOLDER_NAME}" ready).`);
  console.log("");
  console.log("Next steps (docs/setup/backups.md):");
  console.log(
    "1. gh secret set -f .env.drive-backup.local   (or add the 3 values in GitHub → Settings → Secrets and variables → Actions)",
  );
  console.log("2. Delete the file: rm .env.drive-backup.local");
  console.log("3. GitHub → Actions → Weekly backup → Run workflow (production).");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`Failed: ${describeUnexpected(error)}`);
      process.exitCode = 1;
    },
  );
}
