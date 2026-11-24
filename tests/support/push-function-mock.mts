/**
 * E2E stand-in for the `push` Edge Function (M7.2): the app's test-push Server Action calls
 * it through PUSH_FUNCTION_URL. It records each call and answers by the endpoint's last path
 * segment, as the real function would after asking the push service:
 *   ...-gone-...           → {"status":"gone"}
 *   ...-notconfigured-...  → 500 {"error":"not_configured"}
 *   anything else          → {"status":"sent"}
 * GET /calls?endpoint=<endpoint> lists the recorded calls for one endpoint.
 * Usage: node tests/support/push-function-mock.mts <port>
 */
import { createServer } from "node:http";

type Call = { authorization: string | null; apikey: boolean; body: unknown };

const calls = new Map<string, Call[]>();
const port = Number(process.argv[2] ?? 3101);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const reply = (status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.method === "GET" && url.pathname === "/calls") {
    reply(200, calls.get(url.searchParams.get("endpoint") ?? "") ?? []);
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    reply(200, { ok: true });
    return;
  }
  if (request.method !== "POST" || url.pathname !== "/functions/v1/push") {
    reply(404, { error: "not_found" });
    return;
  }
  let text = "";
  request.on("data", (chunk: Buffer) => {
    text += chunk.toString("utf8");
  });
  request.on("end", () => {
    let body: { kind?: unknown; endpoint?: unknown } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      reply(400, { error: "bad_request" });
      return;
    }
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const list = calls.get(endpoint) ?? [];
    list.push({
      authorization: request.headers.authorization ?? null,
      apikey: typeof request.headers.apikey === "string",
      body,
    });
    calls.set(endpoint, list);
    if (endpoint.includes("-gone-")) {
      reply(200, { status: "gone" });
    } else if (endpoint.includes("-notconfigured-")) {
      reply(500, { error: "not_configured" });
    } else {
      reply(200, { status: "sent" });
    }
  });
});

server.listen(port, "127.0.0.1");
