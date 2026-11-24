import { createHash } from "node:crypto";

/**
 * An in-memory Google OAuth + Drive v3 for the backup tests (M7.3): the token endpoint, file
 * listing by folder name or parent, folder creation, resumable upload, metadata and delete.
 * Failures can be injected per endpoint.
 */
export type FakeFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  bytes: Uint8Array;
  createdTime: string;
};

type Failure = { status: number; body: unknown };

export type FakeDrive = {
  fetch: typeof fetch;
  files: Map<string, FakeFile>;
  requests: { method: string; url: string; body?: string }[];
  /** Next N responses of an endpoint fail ("token", "list", "createFolder", "uploadStart", "upload", "get", "delete"). */
  failNext: (endpoint: string, failure: Failure, times?: number) => void;
  corruptMd5: boolean;
  grantedScope: string;
  refreshTokenIssued: string;
  addFile: (file: Omit<FakeFile, "id" | "bytes" | "createdTime"> & { id?: string }) => FakeFile;
};

const FOLDER = "application/vnd.google-apps.folder";

export function createFakeDrive(): FakeDrive {
  const files = new Map<string, FakeFile>();
  const requests: FakeDrive["requests"] = [];
  const failures = new Map<string, Failure[]>();
  const sessions = new Map<string, Omit<FakeFile, "bytes" | "createdTime">>();
  let counter = 0;
  const nextId = () => `id${String(++counter).padStart(4, "0")}`;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });

  const failure = (endpoint: string): Response | null => {
    const queue = failures.get(endpoint);
    const next = queue?.shift();
    return next ? json(next.status, next.body) : null;
  };

  const drive: FakeDrive = {
    files,
    requests,
    corruptMd5: false,
    grantedScope: "https://www.googleapis.com/auth/drive.file",
    refreshTokenIssued: "1//fake-refresh-token",
    failNext(endpoint, value, times = 1) {
      const queue = failures.get(endpoint) ?? [];
      for (let i = 0; i < times; i += 1) {
        queue.push(value);
      }
      failures.set(endpoint, queue);
    },
    addFile(file) {
      const created: FakeFile = {
        ...file,
        id: file.id ?? nextId(),
        bytes: new Uint8Array(),
        createdTime: new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString(),
      };
      files.set(created.id, created);
      return created;
    },
    fetch: (async (input: URL | RequestInfo, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      const body = init.body;
      requests.push({
        method,
        url: url.toString(),
        body:
          typeof body === "string" || body instanceof URLSearchParams ? String(body) : undefined,
      });

      if (url.href === "https://oauth2.googleapis.com/token") {
        const failed = failure("token");
        if (failed) return failed;
        const form = new URLSearchParams(String(body));
        if (form.get("grant_type") === "authorization_code") {
          return json(200, {
            access_token: "ya29.fake-access",
            refresh_token: drive.refreshTokenIssued,
            scope: drive.grantedScope,
          });
        }
        return json(200, { access_token: "ya29.fake-access", scope: drive.grantedScope });
      }

      const files_ = "https://www.googleapis.com/drive/v3/files";
      if (url.origin + url.pathname === files_ && method === "GET") {
        const failed = failure("list");
        if (failed) return failed;
        const q = url.searchParams.get("q") ?? "";
        const byName = /^name = '([^']+)' and mimeType = '([^']+)' and trashed = false$/.exec(q);
        const byParent =
          /^'([^']+)' in parents and trashed = false and appProperties has \{ key='(\w+)' and value='1' \}$/.exec(
            q,
          );
        let found = [...files.values()];
        if (byName) {
          found = found.filter((f) => f.name === byName[1] && f.mimeType === byName[2]);
        } else if (byParent) {
          found = found.filter(
            (f) => f.parents.includes(byParent[1]) && f.appProperties[byParent[2]] === "1",
          );
        } else {
          return json(400, { error: { status: "INVALID_ARGUMENT" } });
        }
        found.sort((a, b) => a.createdTime.localeCompare(b.createdTime));
        return json(200, { files: found.map(({ id, name }) => ({ id, name })) });
      }
      if (url.origin + url.pathname === files_ && method === "POST") {
        const failed = failure("createFolder");
        if (failed) return failed;
        const meta = JSON.parse(String(body)) as { name: string; mimeType: string };
        const folder = drive.addFile({
          name: meta.name,
          mimeType: meta.mimeType,
          parents: [],
          appProperties: {},
        });
        return json(200, { id: folder.id });
      }
      if (
        url.href.startsWith("https://www.googleapis.com/upload/drive/v3/files?") &&
        method === "POST"
      ) {
        const failed = failure("uploadStart");
        if (failed) return failed;
        const meta = JSON.parse(String(body)) as Omit<FakeFile, "id" | "bytes" | "createdTime">;
        const session = `s${nextId()}`;
        sessions.set(session, { ...meta, id: "" });
        return json(
          200,
          {},
          { Location: `https://www.googleapis.com/upload/drive/v3/files?upload_id=${session}` },
        );
      }
      if (
        url.href.startsWith("https://www.googleapis.com/upload/drive/v3/files?upload_id=") &&
        method === "PUT"
      ) {
        const failed = failure("upload");
        if (failed) return failed;
        const meta = sessions.get(url.searchParams.get("upload_id") ?? "");
        if (!meta) return json(404, { error: { status: "NOT_FOUND" } });
        const bytes = new Uint8Array(await new Response(body as Blob).arrayBuffer());
        const created = drive.addFile({ ...meta, id: undefined });
        created.bytes = bytes;
        return json(200, { id: created.id });
      }
      const single = /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (url.origin === "https://www.googleapis.com" && single) {
        const file = files.get(single[1]);
        if (method === "GET") {
          const failed = failure("get");
          if (failed) return failed;
          if (!file) return json(404, { error: { status: "NOT_FOUND" } });
          const md5 = createHash("md5").update(file.bytes).digest("hex");
          return json(200, {
            id: file.id,
            size: String(file.bytes.length),
            md5Checksum: drive.corruptMd5 ? "0".repeat(32) : md5,
            trashed: false,
          });
        }
        if (method === "DELETE") {
          const failed = failure("delete");
          if (failed) return failed;
          if (!file) return json(404, { error: { status: "NOT_FOUND" } });
          files.delete(file.id);
          return new Response(null, { status: 204 });
        }
      }
      return json(404, { error: { status: "UNKNOWN_ENDPOINT" } });
    }) as typeof fetch,
  };
  return drive;
}

export { FOLDER as FAKE_FOLDER_MIME };
