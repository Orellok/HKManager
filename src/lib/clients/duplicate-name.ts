/**
 * Duplicate-name warning (M1.1 owner decision): two client names are the same when they are
 * equal after trimming and ignoring case. The key is compared with lower(name) in the
 * database (find_clients_by_name_key), where names are stored trimmed.
 */
export function duplicateNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Whether two names count as the same client name. */
export function isSameClientName(first: string, second: string): boolean {
  return duplicateNameKey(first) === duplicateNameKey(second);
}
