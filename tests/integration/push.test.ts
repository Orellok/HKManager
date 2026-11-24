import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  handlePushRequest,
  SECRET_HEADER,
  type PushEnv,
} from "../../supabase/functions/_shared/handler";
import {
  createTestReceiver,
  createTestVapidKeys,
  type TestReceiver,
} from "../support/web-push-receiver";

import {
  createAnonClient,
  createServiceRoleClient,
  createSignedInUser,
  deleteUser,
  getLocalSupabaseEnv,
  queryLocalDatabase,
  testEmail,
  type TestUser,
} from "./support/local-supabase";
import { runPsqlSession } from "./support/psql-session";

const INSUFFICIENT_PRIVILEGE = "42501";
const CHECK_VIOLATION = "23514";
const MARKER = `it-push-${randomUUID()}`;
/**
 * The daily counts cover every open task in the database, so the scenarios use dates in 1900
 * (no real data; only tests use them) and hide the open tasks of that year before each one.
 * In 1900 Asia/Jerusalem was on local mean time (+02:20:54): 07:00 UTC is 09:20 local.
 */
const TEST_YEAR_END = "1900-12-31";
const LOCAL_NINE_IN_1900 = "T07:00:00Z";
const DST_DATES = { summer: "2098-07-15", winter: "2098-01-15" };

let service: SupabaseClient;
let anon: SupabaseClient;
let outsider: TestUser;
let owner: TestUser;
let admin: TestUser;
let env: PushEnv;
let cronSecret: string;
const createdUserIds: string[] = [];
const usedRunDates = new Set<string>();

type Delivery = { endpoint: string; headers: Record<string, string>; body: Uint8Array };
let deliveries: Delivery[] = [];
const receivers = new Map<string, TestReceiver>();

/** The push service: answers by the endpoint's last path segment. */
const pushFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
  const endpoint = String(input);
  deliveries.push({
    endpoint,
    headers: init?.headers as Record<string, string>,
    body: init?.body as Uint8Array,
  });
  const kind = endpoint.split("/").at(-1)?.split("-")[0];
  if (kind === "throw") {
    throw new TypeError("network down");
  }
  const status = { gone: 410, missing: 404, fail: 500 }[kind ?? ""] ?? 201;
  return new Response(null, { status });
}) as typeof fetch;

function endpointFor(kind: "ok" | "gone" | "missing" | "fail" | "throw"): string {
  return `https://fcm.googleapis.com/fcm/send/${MARKER}/${kind}-${randomUUID()}`;
}

async function subscribe(user: TestUser, kind: Parameters<typeof endpointFor>[0] = "ok") {
  const receiver = await createTestReceiver();
  const endpoint = endpointFor(kind);
  const { data, error } = await user.client.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: receiver.p256dh,
    p_auth: receiver.auth,
    p_user_agent: "Integration test",
  });
  if (error) {
    throw new Error("Could not save a test subscription", { cause: error });
  }
  receivers.set(endpoint, receiver);
  return { id: data as string, endpoint };
}

async function subscriptionRow(endpoint: string) {
  const { data } = await service
    .from("push_subscriptions")
    .select("id, user_id, p256dh, last_success_at")
    .eq("endpoint", endpoint)
    .maybeSingle();
  return data as {
    id: string;
    user_id: string;
    p256dh: string;
    last_success_at: string | null;
  } | null;
}

async function insertTask(fields: Record<string, unknown>) {
  const { data, error } = await service
    .from("tasks")
    .insert({ title: `משימה ${MARKER} ${randomUUID().slice(0, 6)}`, ...fields })
    .select("id, title")
    .single<{ id: string; title: string }>();
  if (error) {
    throw new Error("Could not insert a test task", { cause: error });
  }
  return data;
}

async function hideTestYearTasks() {
  const { error } = await service
    .from("tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("status", "open")
    .is("deleted_at", null)
    .lte("due_date", TEST_YEAR_END);
  if (error) {
    throw new Error("Could not hide the 1900 tasks", { cause: error });
  }
}

async function forgetRun(runDate: string) {
  usedRunDates.add(runDate);
  const { error } = await service.from("reminder_runs").delete().eq("run_date", runDate);
  if (error) {
    throw new Error("Could not delete a test reminder run", { cause: error });
  }
}

async function runRow(runDate: string) {
  const { data } = await service
    .from("reminder_runs")
    .select()
    .eq("run_date", runDate)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

function dailyRequest(secret: string | null = cronSecret) {
  return new Request("http://localhost/functions/v1/push", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { [SECRET_HEADER]: secret } : {}) },
    body: JSON.stringify({ kind: "daily" }),
  });
}

async function runDaily(at: string, overrides: Partial<PushEnv> = {}, secret?: string | null) {
  const response = await handlePushRequest(
    dailyRequest(secret === undefined ? cronSecret : secret),
    {
      env: { ...env, ...overrides },
      now: () => new Date(at),
      pushFetch,
      log: () => undefined,
    },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function accessToken(user: TestUser) {
  const { data } = await user.client.auth.getSession();
  return data.session?.access_token ?? "";
}

async function runTest(token: string | null, endpoint: unknown) {
  const response = await handlePushRequest(
    new Request("http://localhost/functions/v1/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ kind: "test", endpoint }),
    }),
    { env, pushFetch, log: () => undefined },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The decrypted payloads delivered to this test's endpoints. */
async function payloadsTo(endpoints: string[]) {
  return Promise.all(
    deliveries
      .filter((delivery) => endpoints.includes(delivery.endpoint))
      .map(async (delivery) =>
        JSON.parse(await receivers.get(delivery.endpoint)!.decrypt(delivery.body)),
      ),
  );
}

beforeAll(async () => {
  service = await createServiceRoleClient();
  anon = await createAnonClient();
  outsider = await createSignedInUser(service, testEmail("push-outsider"));
  owner = await createSignedInUser(service, testEmail("push-owner"));
  admin = await createSignedInUser(service, testEmail("push-admin"));
  createdUserIds.push(outsider.id, owner.id, admin.id);
  const { error } = await service.from("allowed_users").insert([
    { email: owner.email, role: "owner" },
    { email: admin.email, role: "admin" },
  ]);
  if (error) {
    throw new Error("Could not allowlist the test users", { cause: error });
  }
  const local = await getLocalSupabaseEnv();
  env = {
    supabaseUrl: local.url,
    anonKey: local.anonKey,
    serviceRoleKey: local.serviceRoleKey,
    vapid: await createTestVapidKeys(),
  };
  const [secretRow] = await queryLocalDatabase<{ decrypted_secret: string }>(
    "select decrypted_secret from vault.decrypted_secrets where name = 'push_reminders_cron_secret'",
  );
  cronSecret = secretRow.decrypted_secret;
});

beforeEach(() => {
  deliveries = [];
});

afterAll(async () => {
  if (!service) {
    return;
  }
  const errors: unknown[] = [];
  const subscriptions = await service
    .from("push_subscriptions")
    .delete()
    .like("endpoint", `%${MARKER}%`);
  const tasks = await service.from("tasks").delete().like("title", `%${MARKER}%`);
  const runs = await service
    .from("reminder_runs")
    .delete()
    .in("run_date", [...usedRunDates]);
  const allowlist = await service
    .from("allowed_users")
    .delete()
    .in("email", [owner?.email, admin?.email].filter(Boolean));
  errors.push(...[subscriptions.error, tasks.error, runs.error, allowlist.error].filter(Boolean));
  for (const id of createdUserIds) {
    try {
      await deleteUser(service, id);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new Error("Cleanup failed", { cause: errors });
  }
});

describe("M7.2-1: push_subscriptions and reminder_runs access", () => {
  it("M7.2-1: anon and a user outside the allowlist can neither read nor save", async () => {
    const { endpoint } = await subscribe(owner);
    expect(
      (await anon.from("push_subscriptions").select("id").eq("endpoint", endpoint)).data ?? [],
    ).toEqual([]);
    const receiver = await createTestReceiver();
    const args = {
      p_endpoint: endpointFor("ok"),
      p_p256dh: receiver.p256dh,
      p_auth: receiver.auth,
      p_user_agent: null,
    };
    expect((await outsider.client.rpc("save_push_subscription", args)).error?.code).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect((await anon.rpc("save_push_subscription", args)).error).not.toBeNull();
    expect((await outsider.client.from("push_subscriptions").select("id")).data).toEqual([]);
  });

  it("M7.2-1: a user sees and deletes only their own subscriptions; no direct insert or update", async () => {
    const own = await subscribe(owner);
    const read = await owner.client
      .from("push_subscriptions")
      .select("id")
      .eq("endpoint", own.endpoint);
    expect(read.data).toEqual([{ id: own.id }]);
    expect(
      (await admin.client.from("push_subscriptions").select("id").eq("id", own.id)).data,
    ).toEqual([]);
    await admin.client.from("push_subscriptions").delete().eq("id", own.id);
    expect(await subscriptionRow(own.endpoint)).not.toBeNull();

    const receiver = await createTestReceiver();
    const insert = await owner.client.from("push_subscriptions").insert({
      user_id: owner.id,
      endpoint: endpointFor("ok"),
      p256dh: receiver.p256dh,
      auth: receiver.auth,
    });
    expect(insert.error?.code).toBe(INSUFFICIENT_PRIVILEGE);
    const update = await owner.client
      .from("push_subscriptions")
      .update({ user_id: admin.id })
      .eq("id", own.id);
    expect(update.error?.code).toBe(INSUFFICIENT_PRIVILEGE);

    await owner.client.from("push_subscriptions").delete().eq("id", own.id);
    expect(await subscriptionRow(own.endpoint)).toBeNull();
  });

  it("M7.2-1: saving an endpoint again updates its keys; another user's save moves it to them", async () => {
    const first = await subscribe(owner);
    const receiver = await createTestReceiver();
    const again = await owner.client.rpc("save_push_subscription", {
      p_endpoint: first.endpoint,
      p_p256dh: receiver.p256dh,
      p_auth: receiver.auth,
      p_user_agent: "x",
    });
    expect(again.data).toBe(first.id);
    expect((await subscriptionRow(first.endpoint))?.p256dh).toBe(receiver.p256dh);
    const moved = await admin.client.rpc("save_push_subscription", {
      p_endpoint: first.endpoint,
      p_p256dh: receiver.p256dh,
      p_auth: receiver.auth,
      p_user_agent: "x",
    });
    expect(moved.data).toBe(first.id);
    expect((await subscriptionRow(first.endpoint))?.user_id).toBe(admin.id);
    receivers.set(first.endpoint, receiver);
  });

  it("M7.2-1: the database rejects other hosts, http, and malformed keys", async () => {
    const receiver = await createTestReceiver();
    const save = (fields: Record<string, unknown>) =>
      owner.client.rpc("save_push_subscription", {
        p_endpoint: endpointFor("ok"),
        p_p256dh: receiver.p256dh,
        p_auth: receiver.auth,
        p_user_agent: null,
        ...fields,
      });
    for (const endpoint of [
      `https://evil.example/${MARKER}`,
      `http://fcm.googleapis.com/fcm/send/${MARKER}`,
      `https://fcm.googleapis.com.evil.example/${MARKER}`,
    ]) {
      expect((await save({ p_endpoint: endpoint })).error?.code).toBe(CHECK_VIOLATION);
    }
    expect((await save({ p_p256dh: "A".repeat(87) })).error?.code).toBe(CHECK_VIOLATION);
    expect((await save({ p_auth: "short" })).error?.code).toBe(CHECK_VIOLATION);
    expect((await save({ p_user_agent: "x".repeat(301) })).error?.code).toBe(CHECK_VIOLATION);
  });

  it("M7.2-1: reminder_runs and the run functions are closed to signed-in users", async () => {
    expect((await owner.client.from("reminder_runs").select("id")).error?.code).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    for (const [name, args] of [
      ["claim_reminder_run", { p_run_date: "1900-03-01" }],
      ["finish_reminder_run", { p_run_date: "1900-03-01", p_sent: 0, p_failed: 0 }],
      ["verify_reminders_secret", { p_secret: "x" }],
      ["configure_push_reminders", { p_function_url: "https://x.supabase.co/functions/v1/push" }],
      ["invoke_daily_reminders", {}],
    ] as const) {
      const { error } = await owner.client.rpc(name, args);
      expect(error?.code, name).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe("M7.2-2: schedule and configuration", () => {
  it("M7.2-2: pg_cron and pg_net are installed and two jobs run at 06:00 and 07:00 UTC", async () => {
    const extensions = await queryLocalDatabase<{ extname: string }>(
      "select extname from pg_extension where extname in ('pg_cron', 'pg_net') order by extname",
    );
    expect(extensions.map((row) => row.extname)).toEqual(["pg_cron", "pg_net"]);
    const jobs = await queryLocalDatabase<{ jobname: string; schedule: string; command: string }>(
      "select jobname, schedule, command from cron.job where jobname like 'push-daily-reminders-%' order by jobname",
    );
    expect(jobs).toEqual([
      {
        jobname: "push-daily-reminders-0600-utc",
        schedule: "0 6 * * *",
        command: "select public.invoke_daily_reminders()",
      },
      {
        jobname: "push-daily-reminders-0700-utc",
        schedule: "0 7 * * *",
        command: "select public.invoke_daily_reminders()",
      },
    ]);
  });

  it("M7.2-2: the migration's extension check names what is missing", async () => {
    const result = await runPsqlSession(`
      begin;
      create temporary view pg_available_extensions as
        select name from pg_catalog.pg_available_extensions where name <> 'pg_cron';
      do $$
      declare missing text[];
      begin
        select array_agg(required.name) into missing
        from (values ('pg_cron'), ('pg_net'), ('supabase_vault')) as required (name)
        where not exists (select 1 from pg_temp.pg_available_extensions as e where e.name = required.name);
        if missing is not null then
          raise exception 'M7.2 push: required extension(s) not available on this database: %', missing;
        end if;
      end $$;
      rollback;`);
    expect(result).toMatchObject({ ok: false, sqlState: "P0001" });
    expect(result.ok ? "" : result.message).toContain("{pg_cron}");
  });

  it("M7.2-2: without a configured URL a cron run fails loudly; with one it queues a POST", async () => {
    const missing = await runPsqlSession(`
      begin;
      delete from vault.secrets where name = 'push_reminders_url';
      select public.invoke_daily_reminders();
      rollback;`);
    expect(missing).toMatchObject({ ok: false, sqlState: "HKP02" });
    const configured = await runPsqlSession(`
      begin;
      select public.configure_push_reminders('http://kong:8000/functions/v1/push');
      select public.configure_push_reminders('https://abcdefghijklmnopqrst.supabase.co/functions/v1/push');
      do $$
      declare request_id bigint;
      begin
        request_id := public.invoke_daily_reminders();
        if not exists (
          select 1 from net.http_request_queue as q
          where q.id = request_id
            and q.url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/push'
            and q.method = 'POST'
            and q.headers ? 'x-reminders-secret'
        ) then
          raise exception 'no queued request';
        end if;
      end $$;
      rollback;`);
    expect(configured).toEqual({ ok: true });
  });

  it("M7.2-2: configure_push_reminders accepts only a push function URL", async () => {
    for (const url of [
      "https://evil.example/x",
      // M7.3-12(d): only this project's Supabase function URL, not any host with that path.
      "https://evil.example/functions/v1/push",
      "https://abcdefgh.supabase.co/functions/v1/push",
      "https://abcdefghijklmnopqrst.supabase.co.evil.example/functions/v1/push",
      "https://abcdefghijklmnopqrst.example.co/functions/v1/push",
      "http://example.com/functions/v1/push",
      "javascript:alert(1)",
    ]) {
      const { error } = await service.rpc("configure_push_reminders", { p_function_url: url });
      expect(error?.code, url).toBe("22023");
    }
  });
});

describe("M7.2-3: the daily run", () => {
  it("M7.2-3: a missing or wrong secret is refused before anything is claimed", async () => {
    await forgetRun("1900-04-01");
    expect((await runDaily(`1900-04-01${LOCAL_NINE_IN_1900}`, {}, null)).status).toBe(401);
    expect((await runDaily(`1900-04-01${LOCAL_NINE_IN_1900}`, {}, "wrong")).status).toBe(401);
    expect(await runRow("1900-04-01")).toBeNull();
    expect(deliveries).toEqual([]);
  });

  it("M7.2-3: sends only at 09:00 local time, in summer (06:00 UTC) and in winter (07:00 UTC)", async () => {
    await subscribe(owner);
    for (const date of Object.values(DST_DATES)) {
      await forgetRun(date);
    }
    expect((await runDaily(`${DST_DATES.summer}T07:00:00Z`)).body).toEqual({
      status: "outside_hour",
      hour: 10,
    });
    expect((await runDaily(`${DST_DATES.winter}T06:00:00Z`)).body).toEqual({
      status: "outside_hour",
      hour: 8,
    });
    expect(await runRow(DST_DATES.summer)).toBeNull();
    expect(await runRow(DST_DATES.winter)).toBeNull();
    // Every open task of the database is overdue in 2098, so both runs send.
    await insertTask({ due_date: "2097-01-01" });
    expect((await runDaily(`${DST_DATES.summer}T06:00:00Z`)).body).toMatchObject({
      status: "sent",
      runDate: DST_DATES.summer,
    });
    expect((await runDaily(`${DST_DATES.winter}T07:00:00Z`)).body).toMatchObject({
      status: "sent",
      runDate: DST_DATES.winter,
    });
  });

  it("M7.2-3: a second run or a retry on the same local date sends nothing (NOTIF-9)", async () => {
    await hideTestYearTasks();
    await forgetRun("1900-04-02");
    const { endpoint } = await subscribe(owner);
    await insertTask({ due_date: "1900-04-02" });
    expect((await runDaily(`1900-04-02${LOCAL_NINE_IN_1900}`)).body).toMatchObject({
      status: "sent",
    });
    const sentTo = deliveries.filter((delivery) => delivery.endpoint === endpoint).length;
    expect(sentTo).toBe(1);
    expect((await runDaily(`1900-04-02${LOCAL_NINE_IN_1900}`)).body).toEqual({
      status: "already_ran",
      runDate: "1900-04-02",
    });
    expect(deliveries.filter((delivery) => delivery.endpoint === endpoint)).toHaveLength(1);
    await forgetRun("1900-04-03");
    const [first, second] = await Promise.all([
      runDaily(`1900-04-03${LOCAL_NINE_IN_1900}`),
      runDaily(`1900-04-03${LOCAL_NINE_IN_1900}`),
    ]);
    expect([first.body.status, second.body.status].sort()).toEqual(["already_ran", "sent"]);
  });

  it("M7.2-3: nothing due → no notification, the run is still recorded", async () => {
    await hideTestYearTasks();
    await forgetRun("1900-04-04");
    await subscribe(owner);
    // Not counted: done, cancelled, deleted, without a due date, due after tomorrow.
    await insertTask({ due_date: "1900-04-04", status: "done" });
    await insertTask({ due_date: "1900-04-01", status: "cancelled" });
    const deleted = await insertTask({ due_date: "1900-04-04" });
    await service
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", deleted.id);
    await insertTask({ due_date: null });
    await insertTask({ due_date: "1900-04-06" });
    expect((await runDaily(`1900-04-04${LOCAL_NINE_IN_1900}`)).body).toEqual({
      status: "nothing_due",
      runDate: "1900-04-04",
    });
    expect(deliveries).toEqual([]);
    expect(await runRow("1900-04-04")).toMatchObject({
      count_today: 0,
      count_tomorrow: 0,
      count_overdue: 0,
      subscriptions_sent: 0,
      subscriptions_failed: 0,
    });
    expect((await runRow("1900-04-04"))?.sent_at).not.toBeNull();
  });

  it("M7.2-3/4: one summary per subscription with the counts of each group", async () => {
    await hideTestYearTasks();
    await forgetRun("1900-05-10");
    const first = await subscribe(owner);
    const second = await subscribe(admin);
    await insertTask({ due_date: "1900-05-10" });
    await insertTask({ due_date: "1900-05-10", priority: "high" });
    await insertTask({ due_date: "1900-05-11" });
    await insertTask({ due_date: "1900-05-09" });
    await insertTask({ due_date: "1900-01-01" });
    await insertTask({ due_date: "1900-05-01" });
    await insertTask({ due_date: "1900-05-10", status: "done" });
    const result = await runDaily(`1900-05-10${LOCAL_NINE_IN_1900}`);
    expect(result.body).toMatchObject({
      status: "sent",
      runDate: "1900-05-10",
      failed: 0,
      removed: 0,
    });
    const payloads = await payloadsTo([first.endpoint, second.endpoint]);
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) {
      expect(payload).toEqual({
        title: "HKManager",
        body: "2 משימות להיום · 1 למחר · 3 באיחור",
        url: "/tasks",
        tag: "hkmanager-daily",
      });
    }
    const delivery = deliveries.find((candidate) => candidate.endpoint === first.endpoint);
    expect(delivery?.headers).toMatchObject({
      TTL: "43200",
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
    });
    expect(await runRow("1900-05-10")).toMatchObject({
      count_today: 2,
      count_tomorrow: 1,
      count_overdue: 3,
    });
    expect((await subscriptionRow(first.endpoint))?.last_success_at).not.toBeNull();
  });

  it.each([
    ["today", "1900-05-20", "להיום"],
    ["tomorrow", "1900-05-21", "למחר"],
    ["overdue", "1900-05-02", "באיחור"],
  ])("M7.2-4: a single %s task shows its title and state", async (_group, dueDate, label) => {
    await hideTestYearTasks();
    await forgetRun("1900-05-20");
    const { endpoint } = await subscribe(owner);
    const task = await insertTask({ due_date: dueDate });
    await runDaily(`1900-05-20${LOCAL_NINE_IN_1900}`);
    const [payload] = await payloadsTo([endpoint]);
    expect(payload.body).toBe(`${task.title} · ${label}`);
  });

  it.each([
    [{ today: 2 }, "2 משימות להיום"],
    [{ tomorrow: 3 }, "3 משימות למחר"],
    [{ overdue: 2 }, "2 משימות באיחור"],
    [{ today: 1, tomorrow: 1 }, "משימה אחת להיום · 1 למחר"],
    [{ today: 1, overdue: 1 }, "משימה אחת להיום · 1 באיחור"],
    [{ tomorrow: 1, overdue: 4 }, "משימה אחת למחר · 4 באיחור"],
  ] as const)("M7.2-4: group combination %o → %s", async (groups, expected) => {
    await hideTestYearTasks();
    await forgetRun("1900-06-10");
    const { endpoint } = await subscribe(owner);
    const due = { today: "1900-06-10", tomorrow: "1900-06-11", overdue: "1900-06-01" } as const;
    for (const [group, count] of Object.entries(groups) as [keyof typeof due, number][]) {
      for (let index = 0; index < count; index += 1) {
        await insertTask({ due_date: due[group] });
      }
    }
    await runDaily(`1900-06-10${LOCAL_NINE_IN_1900}`);
    const [payload] = await payloadsTo([endpoint]);
    expect(payload.body).toBe(expected);
  });

  it("M7.2-5: 404/410 delete the subscription; other failures are counted and do not stop the rest", async () => {
    await hideTestYearTasks();
    await forgetRun("1900-07-01");
    const ok = await subscribe(owner);
    const gone = await subscribe(owner, "gone");
    const missing = await subscribe(admin, "missing");
    const failing = await subscribe(admin, "fail");
    const throwing = await subscribe(owner, "throw");
    await insertTask({ due_date: "1900-07-01" });
    const logged: string[] = [];
    const response = await handlePushRequest(dailyRequest(), {
      env,
      now: () => new Date(`1900-07-01${LOCAL_NINE_IN_1900}`),
      pushFetch,
      log: (message) => logged.push(message),
    });
    const body = (await response.json()) as Record<string, number>;
    expect(response.status).toBe(200);
    expect(body.failed).toBeGreaterThanOrEqual(2);
    expect(body.removed).toBeGreaterThanOrEqual(2);
    expect(await subscriptionRow(gone.endpoint)).toBeNull();
    expect(await subscriptionRow(missing.endpoint)).toBeNull();
    expect(await subscriptionRow(failing.endpoint)).not.toBeNull();
    expect(await subscriptionRow(throwing.endpoint)).not.toBeNull();
    expect((await subscriptionRow(ok.endpoint))?.last_success_at).not.toBeNull();
    expect((await subscriptionRow(failing.endpoint))?.last_success_at).toBeNull();
    expect(await runRow("1900-07-01")).toMatchObject({
      subscriptions_sent: body.sent,
      subscriptions_failed: body.failed,
    });
    expect(logged).toEqual(
      expect.arrayContaining([
        "push: daily delivery failed (status 500)",
        "push: daily delivery failed (TypeError)",
      ]),
    );
    expect(logged.join("\n")).not.toContain("fcm.googleapis.com");
  });

  it("M7.2-5: without the VAPID secrets nothing is claimed or sent", async () => {
    await forgetRun("1900-07-02");
    const result = await runDaily(`1900-07-02${LOCAL_NINE_IN_1900}`, { vapid: null });
    expect(result).toEqual({ status: 500, body: { error: "not_configured" } });
    expect(await runRow("1900-07-02")).toBeNull();
  });

  it("M7.2-3: only POST with a JSON object of a known kind", async () => {
    const call = (init: RequestInit) =>
      handlePushRequest(new Request("http://localhost/functions/v1/push", init), {
        env,
        pushFetch,
        log: () => undefined,
      });
    expect((await call({ method: "GET" })).status).toBe(405);
    expect((await call({ method: "POST", body: "not json" })).status).toBe(400);
    expect((await call({ method: "POST", body: "[]" })).status).toBe(400);
    expect((await call({ method: "POST", body: JSON.stringify({ kind: "other" }) })).status).toBe(
      400,
    );
    expect(
      (
        await call({
          method: "POST",
          body: JSON.stringify({ kind: "daily", pad: "x".repeat(5000) }),
        })
      ).status,
    ).toBe(400);
  });
});

describe("M7.2-6: the test push", () => {
  it("M7.2-6: sends the test message to the caller's own subscription only", async () => {
    const own = await subscribe(owner);
    const result = await runTest(await accessToken(owner), own.endpoint);
    expect(result).toEqual({ status: 200, body: { status: "sent" } });
    const [payload] = await payloadsTo([own.endpoint]);
    expect(payload).toEqual({
      title: "HKManager",
      body: "התראת בדיקה: ההתראות במכשיר הזה פועלות.",
      url: "/settings",
      tag: "hkmanager-test",
    });
    expect(deliveries.find((delivery) => delivery.endpoint === own.endpoint)?.headers.TTL).toBe(
      "600",
    );
    deliveries = [];
    expect((await runTest(await accessToken(admin), own.endpoint)).body).toEqual({
      status: "not_found",
    });
    expect((await runTest(await accessToken(outsider), own.endpoint)).body).toEqual({
      status: "not_found",
    });
    expect(deliveries).toEqual([]);
  });

  it("M7.2-6: no token, a forged token or a bad endpoint is refused", async () => {
    const own = await subscribe(owner);
    expect((await runTest(null, own.endpoint)).status).toBe(401);
    expect((await runTest("not-a-jwt", own.endpoint)).status).toBe(401);
    expect((await runTest(await accessToken(owner), 42)).status).toBe(400);
    expect((await runTest(await accessToken(owner), "x".repeat(2049))).status).toBe(400);
    expect(deliveries).toEqual([]);
  });

  it("M7.2-6: a subscription the push service no longer knows is deleted", async () => {
    const gone = await subscribe(owner, "gone");
    expect((await runTest(await accessToken(owner), gone.endpoint)).body).toEqual({
      status: "gone",
    });
    expect(await subscriptionRow(gone.endpoint)).toBeNull();
    const failing = await subscribe(owner, "fail");
    expect((await runTest(await accessToken(owner), failing.endpoint)).body).toEqual({
      status: "failed",
    });
    expect(await subscriptionRow(failing.endpoint)).not.toBeNull();
  });
});
