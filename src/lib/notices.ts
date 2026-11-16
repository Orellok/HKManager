/**
 * One-time confirmations after a redirect, e.g. `?notice=created`. The codes carry no
 * personal data (SPEC 8); each feature maps its codes to texts and the page shows the text
 * with <RedirectNotice>, which then removes the parameter from the address.
 */
export const NOTICE_PARAM = "notice";

export function withNotice(path: string, notice: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${NOTICE_PARAM}=${encodeURIComponent(notice)}`;
}

/** The message for a `?notice=` value, or undefined for a missing or unknown code. */
export function noticeMessage<Code extends string>(
  messages: Record<Code, string>,
  code: unknown,
): string | undefined {
  return typeof code === "string" && Object.hasOwn(messages, code)
    ? messages[code as Code]
    : undefined;
}
