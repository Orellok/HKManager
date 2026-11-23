import type { SupabaseClient } from "@supabase/supabase-js";

import { z } from "@/lib/zod";

/**
 * Read-only access to app_settings (SPEC 5.14). Owner decision (M2.2): no editing screen yet;
 * the values come from the migration's seed. Every value is validated, and a missing or
 * invalid one falls back to the SPEC default (DOC-4), so a bad row can never break a screen.
 */

export const RECEIPT_SETTING_KEYS = {
  providerName: "receipt_provider_name",
  providerUrl: "receipt_provider_url",
  monthlyQuota: "receipt_monthly_quota",
} as const;

export const RECEIPT_SETTINGS_DEFAULTS = {
  providerName: "SUMIT",
  providerUrl: "https://app.sumit.co.il/",
  monthlyQuota: 10,
} as const;

/** The most receipts a monthly quota can name; anything larger is treated as invalid. */
const MAX_MONTHLY_QUOTA = 10_000;

export type ReceiptSettings = {
  /** The receipt provider's name, e.g. "SUMIT". */
  providerName: string;
  /** Where the user issues receipts (https only). */
  providerUrl: string;
  /** DOC-4: receipts the provider's plan includes per month (at least 1). */
  monthlyQuota: number;
};

const SCHEMAS = {
  providerName: z.string().trim().min(1).max(100),
  providerUrl: z.url({ protocol: /^https$/ }).max(2000),
  monthlyQuota: z.number().int().min(1).max(MAX_MONTHLY_QUOTA),
};

type SettingRow = { key: string; value: unknown };

/** The receipt settings from app_settings rows, each falling back to its default. */
export function parseReceiptSettings(rows: readonly SettingRow[]): ReceiptSettings {
  const valueOf = (key: string) => rows.find((row) => row.key === key)?.value;
  return {
    providerName: SCHEMAS.providerName
      .catch(RECEIPT_SETTINGS_DEFAULTS.providerName)
      .parse(valueOf(RECEIPT_SETTING_KEYS.providerName)),
    providerUrl: SCHEMAS.providerUrl
      .catch(RECEIPT_SETTINGS_DEFAULTS.providerUrl)
      .parse(valueOf(RECEIPT_SETTING_KEYS.providerUrl)),
    monthlyQuota: SCHEMAS.monthlyQuota
      .catch(RECEIPT_SETTINGS_DEFAULTS.monthlyQuota)
      .parse(valueOf(RECEIPT_SETTING_KEYS.monthlyQuota)),
  };
}

/** DOC-1 / DOC-4: the receipt provider settings. Call after requireAllowedUser(). */
export async function getReceiptSettings(supabase: SupabaseClient): Promise<ReceiptSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", Object.values(RECEIPT_SETTING_KEYS));
  if (error) {
    throw new Error("Could not read the receipt settings", { cause: error });
  }
  return parseReceiptSettings(data as SettingRow[]);
}
