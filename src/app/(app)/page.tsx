import { getReceiptSettings, type ReceiptSettings } from "@/lib/app-settings";
import { requireAllowedUser } from "@/lib/auth/guards";
import {
  CEILING_EXCEEDED_PERCENT,
  ceilingStatus,
  formatCeilingPercent,
} from "@/lib/ceiling/status";
import {
  currentMonthPeriod,
  parsePeriod,
  periodLabel,
  previousPeriodLabel,
} from "@/lib/dashboard/period";
import { getDashboardData, type DashboardData } from "@/lib/dashboard/queries";
import { todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TaskReminderCounts } from "@/lib/tasks/grouping";
import { getTaskReminderCounts, listDashboardTasks, type TaskListItem } from "@/lib/tasks/queries";

import { ActionCards } from "./_dashboard/action-cards";
import { CategorySection } from "./_dashboard/category-section";
import { CeilingBanners } from "./_dashboard/ceiling-banners";
import { CeilingProgress } from "./_dashboard/ceiling-progress";
import { MonthlySection } from "./_dashboard/monthly-section";
import { PeriodSelector } from "./_dashboard/period-selector";
import { PeriodSummary } from "./_dashboard/period-summary";
import { OverdueTasksBanner, TasksCard } from "./_dashboard/tasks-card";

/**
 * The home screen is the dashboard (SPEC 5.9, 5.10): the ceiling banners (CEIL-4/5), the
 * period selector (DASH-1), the tax year's ceiling (CEIL-3/6), the period's measures
 * (DASH-2), the action cards (DASH-5, with the tasks card and the overdue banner of
 * NOTIF-2), the 12-month chart (DASH-3) and the expenses by
 * category (DASH-4). Lead decision: the ceiling and its banners follow the tax year of the
 * selected period (the current year by default).
 *
 * Every number comes from one database function in one round trip, read in parallel with
 * the receipt settings. "Today" is todayInJerusalem(): the month and year turn at local
 * midnight in Israel.
 */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  // AUTH-3: every page checks the session itself (see the (app) layout).
  await requireAllowedUser();
  const today = todayInJerusalem();
  const currentMonth = currentMonthPeriod(today);
  const period = parsePeriod(await searchParams, today);

  let data: DashboardData;
  let settings: ReceiptSettings;
  let taskCounts: TaskReminderCounts;
  let tasks: TaskListItem[];
  try {
    const supabase = await createSupabaseServerClient();
    [data, settings, taskCounts, tasks] = await Promise.all([
      getDashboardData(supabase, period, today),
      getReceiptSettings(supabase),
      getTaskReminderCounts(supabase, today),
      listDashboardTasks(supabase, today),
    ]);
  } catch (error) {
    // Logged by code only (SPEC 8); the selector stays usable to try again.
    logDbFailure("dashboard", "read", error);
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">דף הבית</h1>
        <p className="text-destructive font-medium">
          לא הצלחנו לטעון את נתוני הדף. אפשר לרענן את הדף ולנסות שוב.
        </p>
        <PeriodSelector period={period} currentMonth={currentMonth} />
      </div>
    );
  }

  const status = ceilingStatus(data.ceiling);
  const label = periodLabel(period);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">דף הבית</h1>
      <OverdueTasksBanner count={taskCounts.overdue} />
      {status.state === "set" ? (
        <CeilingBanners
          year={status.year}
          banner={status.banner}
          exceeded={status.crossed === CEILING_EXCEEDED_PERCENT}
          percentText={formatCeilingPercent(status.percentTenths)}
        />
      ) : null}
      <PeriodSelector period={period} currentMonth={currentMonth} />
      <CeilingProgress status={status} basis={data.ceiling.basis} isAdmin={data.isAdmin} />
      <PeriodSummary
        data={data.period}
        periodLabel={label}
        previousLabel={previousPeriodLabel(period)}
      />
      <ActionCards
        cards={data.cards}
        monthlyQuota={settings.monthlyQuota}
        tasks={<TasksCard counts={taskCounts} tasks={tasks} today={today} />}
      />
      <MonthlySection series={data.series} />
      <CategorySection
        categories={data.categories}
        periodTotal={data.period.expense}
        periodLabel={label}
      />
    </div>
  );
}
