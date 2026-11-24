/**
 * The daily push reminder (NOTIF-7..11, 15, 16) and the test push (NOTIF-14), independent of
 * the runtime: storage and delivery are passed in, so the same code runs in the Edge Function
 * and in the tests.
 */

const BUSINESS_TIME_ZONE = "Asia/Jerusalem";
/** NOTIF-7: the reminder goes out at 09:00 local time. */
export const REMINDER_LOCAL_HOUR = 9;
export const NOTIFICATION_TITLE = "HKManager";
/** NOTIF-10: a click opens the tasks screen. */
export const DAILY_TARGET_PATH = "/tasks";
export const TEST_TARGET_PATH = "/settings";
/** A newer reminder replaces an older one still on the screen. */
export const DAILY_TAG = "hkmanager-daily";
export const TEST_TAG = "hkmanager-test";
export const TEST_BODY = "התראת בדיקה: ההתראות במכשיר הזה פועלות.";
/** Kept by the push service while the phone is off; a morning summary is useless next day. */
export const DAILY_TTL_SECONDS = 12 * 60 * 60;
export const TEST_TTL_SECONDS = 10 * 60;
/** The daily job reads at most this many subscriptions (the database allows 50). */
export const MAX_SUBSCRIPTIONS = 50;

const LOCAL_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** The date ("YYYY-MM-DD") and hour (0–23) in Asia/Jerusalem at `now`, DST included. */
export function jerusalemDateAndHour(now: Date): { date: string; hour: number } {
  const parts = LOCAL_PARTS.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
  };
}

export type ReminderGroup = "today" | "tomorrow" | "overdue";

export type ReminderCounts = { today: number; tomorrow: number; overdue: number };

const GROUP_ORDER: readonly ReminderGroup[] = ["today", "tomorrow", "overdue"];
const GROUP_LABELS: Record<ReminderGroup, string> = {
  today: "להיום",
  tomorrow: "למחר",
  overdue: "באיחור",
};
const SEPARATOR = " · ";

/**
 * NOTIF-8 / NOTIF-15: the text of the daily summary, or null when nothing is due (no
 * notification). Non-empty groups only, today · tomorrow · overdue; the first carries the
 * noun ("2 משימות להיום · 1 למחר · 3 באיחור"). One task in total: its title and its state.
 * Nothing but counts or that one title: no client, address or amount.
 */
export function summaryBody(
  counts: ReminderCounts,
  single: { title: string; group: ReminderGroup } | null,
): string | null {
  const total = counts.today + counts.tomorrow + counts.overdue;
  if (total <= 0) {
    return null;
  }
  if (total === 1 && single) {
    return `${single.title}${SEPARATOR}${GROUP_LABELS[single.group]}`;
  }
  return GROUP_ORDER.filter((group) => counts[group] > 0)
    .map((group, index) => {
      const count = counts[group];
      if (index > 0) {
        return `${count} ${GROUP_LABELS[group]}`;
      }
      return count === 1
        ? `משימה אחת ${GROUP_LABELS[group]}`
        : `${count} משימות ${GROUP_LABELS[group]}`;
    })
    .join(SEPARATOR);
}

/** What the service worker reads (public/sw.js). */
export type NotificationPayload = { title: string; body: string; url: string; tag: string };

export function dailyPayload(body: string): NotificationPayload {
  return { title: NOTIFICATION_TITLE, body, url: DAILY_TARGET_PATH, tag: DAILY_TAG };
}

export function testPayload(): NotificationPayload {
  return { title: NOTIFICATION_TITLE, body: TEST_BODY, url: TEST_TARGET_PATH, tag: TEST_TAG };
}

export type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

export type ClaimedRun = {
  claimed: boolean;
  counts: ReminderCounts;
  single: { title: string; group: ReminderGroup } | null;
};

/** The database side of the daily run (service role). */
export type ReminderStore = {
  claimRun(runDate: string): Promise<ClaimedRun>;
  listSubscriptions(limit: number): Promise<StoredSubscription[]>;
  markDelivered(ids: string[]): Promise<void>;
  deleteSubscriptions(ids: string[]): Promise<void>;
  finishRun(runDate: string, sent: number, failed: number): Promise<void>;
};

/** Sends one payload; resolves to the push service's HTTP status. */
export type PushSender = (
  target: StoredSubscription,
  payload: NotificationPayload,
  ttlSeconds: number,
) => Promise<number>;

/** Logs without personal data: never an endpoint, a key or a payload. */
export type SafeLogger = (message: string) => void;

export type DeliveryOutcome = "delivered" | "gone" | "failed";

/** NOTIF-11: 404/410 means the subscription no longer exists. */
export function outcomeOf(status: number): DeliveryOutcome {
  if (status >= 200 && status < 300) {
    return "delivered";
  }
  return status === 404 || status === 410 ? "gone" : "failed";
}

export type DailyResult =
  | { status: "outside_hour"; hour: number }
  | { status: "already_ran"; runDate: string }
  | { status: "nothing_due"; runDate: string }
  | { status: "sent"; runDate: string; sent: number; failed: number; removed: number };

/**
 * NOTIF-7..11 and 16: sends the day's summary once, at 09:00 local time, to every
 * subscription. A failure to one subscription is logged and does not stop the others.
 */
export async function runDailyReminders(deps: {
  store: ReminderStore;
  send: PushSender;
  now: Date;
  log: SafeLogger;
}): Promise<DailyResult> {
  const { date, hour } = jerusalemDateAndHour(deps.now);
  if (hour !== REMINDER_LOCAL_HOUR) {
    return { status: "outside_hour", hour };
  }
  const run = await deps.store.claimRun(date);
  if (!run.claimed) {
    return { status: "already_ran", runDate: date };
  }
  const body = summaryBody(run.counts, run.single);
  if (body === null) {
    await deps.store.finishRun(date, 0, 0);
    return { status: "nothing_due", runDate: date };
  }
  const payload = dailyPayload(body);
  const subscriptions = await deps.store.listSubscriptions(MAX_SUBSCRIPTIONS);
  const outcomes = await Promise.all(
    subscriptions.map(async (subscription): Promise<DeliveryOutcome> => {
      try {
        const status = await deps.send(subscription, payload, DAILY_TTL_SECONDS);
        const outcome = outcomeOf(status);
        if (outcome === "failed") {
          deps.log(`push: daily delivery failed (status ${status})`);
        }
        return outcome;
      } catch (error) {
        deps.log(`push: daily delivery failed (${errorName(error)})`);
        return "failed";
      }
    }),
  );
  const idsWith = (wanted: DeliveryOutcome) =>
    subscriptions.filter((_, index) => outcomes[index] === wanted).map(({ id }) => id);
  const delivered = idsWith("delivered");
  const gone = idsWith("gone");
  const failed = idsWith("failed").length;
  await deps.store.markDelivered(delivered);
  await deps.store.deleteSubscriptions(gone);
  await deps.store.finishRun(date, delivered.length, failed);
  return { status: "sent", runDate: date, sent: delivered.length, failed, removed: gone.length };
}

export type TestResult = "sent" | "not_found" | "gone" | "failed";

/** NOTIF-14: one test message to the caller's own subscription (found through RLS). */
export async function sendTestPush(deps: {
  subscription: StoredSubscription | null;
  send: PushSender;
  deleteSubscription: (id: string) => Promise<void>;
  markDelivered: (id: string) => Promise<void>;
  log: SafeLogger;
}): Promise<TestResult> {
  if (!deps.subscription) {
    return "not_found";
  }
  let status: number;
  try {
    status = await deps.send(deps.subscription, testPayload(), TEST_TTL_SECONDS);
  } catch (error) {
    deps.log(`push: test delivery failed (${errorName(error)})`);
    return "failed";
  }
  const outcome = outcomeOf(status);
  if (outcome === "gone") {
    await deps.deleteSubscription(deps.subscription.id);
    return "gone";
  }
  if (outcome === "failed") {
    deps.log(`push: test delivery failed (status ${status})`);
    return "failed";
  }
  await deps.markDelivered(deps.subscription.id);
  return "sent";
}

/** The error's class name only; messages can carry URLs. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}
