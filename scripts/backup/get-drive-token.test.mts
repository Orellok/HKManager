import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeDrive } from "../../tests/support/fake-google-drive";

import {
  buildConsentUrl,
  createPkce,
  parseClientFile,
  runTokenFlow,
  TOKEN_FILE,
} from "./get-drive-token.mts";
import { BACKUP_FOLDER_NAME } from "./google-drive.mts";

const CLIENT = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-secret" };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function outFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "token-test-"));
  dirs.push(dir);
  return join(dir, ".env.drive-backup.local");
}

/** Plays the browser: follows the consent URL straight to the loopback redirect. */
function browser(answer: (url: URL) => Record<string, string>) {
  return async (consentUrl: string) => {
    const url = new URL(consentUrl);
    const redirect = new URL(url.searchParams.get("redirect_uri") as string);
    for (const [key, value] of Object.entries(answer(url))) redirect.searchParams.set(key, value);
    await fetch(redirect);
  };
}

describe("M7.3-8: refresh-token script", () => {
  it("M7.3-8: reads a Desktop client file and refuses a Web client or a broken file", () => {
    expect(
      parseClientFile(
        JSON.stringify({ installed: { client_id: CLIENT.clientId, client_secret: "s" } }),
      ),
    ).toEqual({
      clientId: CLIENT.clientId,
      clientSecret: "s",
    });
    expect(() => parseClientFile(JSON.stringify({ web: {} }))).toThrow(/Desktop app/);
    expect(() => parseClientFile("nope")).toThrow(/not JSON/);
    expect(() => parseClientFile(JSON.stringify({ installed: { client_id: "x" } }))).toThrow(
      /client_id/,
    );
  });

  it("M7.3-8: the consent URL asks offline access to drive.file only, with PKCE S256", () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = new URL(
      buildConsentUrl({
        clientId: "c",
        redirectUri: "http://127.0.0.1:5/",
        state: "s",
        codeChallenge: challenge,
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: "https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256",
      response_type: "code",
    });
  });

  it("M7.3-8: the full loopback flow writes an owner-only file and creates the folder", async () => {
    const drive = createFakeDrive();
    const file = outFile();
    let redirectHost = "";
    await runTokenFlow({
      client: CLIENT,
      outFile: file,
      fetch: drive.fetch,
      showConsentUrl: browser((url) => {
        redirectHost = new URL(url.searchParams.get("redirect_uri") as string).hostname;
        return { code: "auth-code", state: url.searchParams.get("state") as string };
      }),
    });
    expect(redirectHost).toBe("127.0.0.1");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain(
      "GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN=1//fake-refresh-token\n",
    );
    expect(readFileSync(file, "utf8")).toContain(
      `GOOGLE_DRIVE_BACKUP_CLIENT_ID=${CLIENT.clientId}\n`,
    );
    const exchange = new URLSearchParams(
      drive.requests.find((r) => r.body?.includes("authorization_code"))?.body,
    );
    expect(exchange.get("code")).toBe("auth-code");
    expect(exchange.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect([...drive.files.values()].map((f) => f.name)).toEqual([BACKUP_FOLDER_NAME]);
  });

  it("M7.3-8: a wrong state, a denied consent or a missing Drive grant writes nothing", async () => {
    const cases = [
      { answer: () => ({ code: "c", state: "forged" }), error: /state/ },
      {
        answer: (url: URL) => ({
          error: "access_denied",
          state: url.searchParams.get("state") as string,
        }),
        error: /Consent was not given/,
      },
    ];
    for (const { answer, error } of cases) {
      const file = outFile();
      await expect(
        runTokenFlow({
          client: CLIENT,
          outFile: file,
          fetch: createFakeDrive().fetch,
          showConsentUrl: browser(answer),
        }),
      ).rejects.toThrow(error);
      expect(() => statSync(file)).toThrow();
    }
    const drive = createFakeDrive();
    drive.grantedScope = "openid";
    const file = outFile();
    await expect(
      runTokenFlow({
        client: CLIENT,
        outFile: file,
        fetch: drive.fetch,
        showConsentUrl: browser((url) => ({
          code: "c",
          state: url.searchParams.get("state") as string,
        })),
      }),
    ).rejects.toThrow(/Drive permission was not granted/);
    expect(() => statSync(file)).toThrow();
  });

  it("M7.3-8: no answer within the timeout fails", async () => {
    await expect(
      runTokenFlow({
        client: CLIENT,
        outFile: outFile(),
        fetch: createFakeDrive().fetch,
        showConsentUrl: () => undefined,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/No consent within 5 minutes/);
  });

  it("M7.3-8: the token file is git-ignored", () => {
    expect(TOKEN_FILE).toMatch(/\/\.env\.drive-backup\.local$/);
    expect(() => execFileSync("git", ["check-ignore", "-q", TOKEN_FILE])).not.toThrow();
  });
});
