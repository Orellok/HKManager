import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportRows } from "./queries";

const requireAllowedUser = vi.fn();
const exportPages = vi.fn();

vi.mock("@/lib/auth/guards", () => ({ requireAllowedUser: () => requireAllowedUser() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("./queries", () => ({
  exportPages: (...args: unknown[]) => exportPages(...args),
}));

const { exportCsvResponse } = await import("./response");

const BASE = "http://localhost:3000";

async function* pages<Row>(...list: Row[][]): AsyncGenerator<Row[], void, undefined> {
  yield* list;
}

async function* failing(): AsyncGenerator<never[], void, undefined> {
  yield* [];
  throw new Error("database down");
}

const expense: ExportRows["expenses"] = {
  expense_date: "2026-01-05",
  vendor: '+ספק, בע"מ',
  category_name: "חומרים",
  amount: 1_250_050,
  payment_method: "cash",
  has_file: false,
};

beforeEach(() => {
  requireAllowedUser.mockReset();
  exportPages.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("criterion 4 / 5: the export Route Handler response", () => {
  it("criterion 4: a valid range answers with the CSV file, attachment, ASCII name, no-store", async () => {
    exportPages.mockReturnValue(pages([expense]));
    const response = await exportCsvResponse(
      new Request(`${BASE}/export/expenses?from=2026-01-01&to=2026-12-31`),
      "expenses",
    );
    expect(requireAllowedUser).toHaveBeenCalledTimes(1);
    expect(exportPages).toHaveBeenCalledWith({}, "expenses", {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="hkmanager-expenses-2026-01-01_2026-12-31.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe(
      'תאריך,ספק,קטגוריה,סכום,אמצעי תשלום,קיים מסמך\r\n05/01/2026,"\'+ספק, בע""מ",חומרים,12500.50,מזומן,לא\r\n',
    );
  });

  it("criterion 4: access is checked before anything else", async () => {
    requireAllowedUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(
      exportCsvResponse(
        new Request(`${BASE}/export/incomes?from=2026-01-01&to=2026-12-31`),
        "incomes",
      ),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(exportPages).not.toHaveBeenCalled();
  });

  it("criterion 5: an invalid range returns to the export screen with the dates, reading nothing", async () => {
    const response = await exportCsvResponse(
      new Request(`${BASE}/export/incomes?from=2026-03-01&to=2026-02-01`),
      "incomes",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${BASE}/export?from=2026-03-01&to=2026-02-01`);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(exportPages).not.toHaveBeenCalled();
  });

  it("criterion 5: only date-sized values are echoed back (an ISO date plus one character)", async () => {
    const response = await exportCsvResponse(
      new Request(`${BASE}/export/incomes?from=${"x".repeat(500)}`),
      "incomes",
    );
    expect(response.headers.get("location")).toBe(`${BASE}/export?from=xxxxxxxxxxx&to=`);
  });

  it("M6 criterion 12: an over-long hand-made date is never cut into a valid date", async () => {
    const response = await exportCsvResponse(
      new Request(`${BASE}/export/incomes?from=2026-01-0199&to=2026-12-31`),
      "incomes",
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("from")).toBe("2026-01-019");
    expect(location.searchParams.get("to")).toBe("2026-12-31");
    expect(exportPages).not.toHaveBeenCalled();
  });

  it("criterion 5: a failure before the first byte returns to the screen with error=failed", async () => {
    exportPages.mockReturnValue(failing());
    const response = await exportCsvResponse(
      new Request(`${BASE}/export/incomes?from=2026-01-01&to=2026-12-31`),
      "incomes",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${BASE}/export?from=2026-01-01&to=2026-12-31&error=failed`,
    );
    expect(console.error).toHaveBeenCalledWith("incomes: export failed (code none)");
  });
});
