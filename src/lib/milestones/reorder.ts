/** MS-1: moving a milestone one place up or down in its project's list. */

export const MOVE_DIRECTIONS = ["up", "down"] as const;

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number];

/**
 * The index the item at `index` moves to, or null when it is already at that edge (first for
 * "up", last for "down") and nothing moves.
 */
export function moveTargetIndex(
  index: number,
  length: number,
  direction: MoveDirection,
): number | null {
  if (index < 0 || index >= length) {
    return null;
  }
  const target = direction === "up" ? index - 1 : index + 1;
  return target >= 0 && target < length ? target : null;
}
