/** The answer of a Server Action that changes a record's state (archive, restore, delete). */
export type ActionStatus = { message: string | null; error: string | null };

export const NO_ACTION_STATUS: ActionStatus = { message: null, error: null };
