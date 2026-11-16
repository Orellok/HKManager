/**
 * A count read from the database (count(*) is bigint, which PostgREST sends as a JSON number;
 * a string of digits is accepted too). Must be a non-negative safe integer: a larger value
 * would have lost precision in JSON and is rejected rather than shown wrong.
 */
export function countFromDb(value: unknown): number {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("The database returned a count outside the supported range");
  }
  return count;
}
