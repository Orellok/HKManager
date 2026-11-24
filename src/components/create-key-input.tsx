import { CREATE_KEY_FIELD } from "@/lib/create-key";

/**
 * M7.1-8: the create form's key (rendered by the page on the server), so a repeated submit of
 * the same form does not create a second row. Nothing for an edit form.
 */
export function CreateKeyInput({ value }: { value: string | null | undefined }) {
  return value ? <input type="hidden" name={CREATE_KEY_FIELD} value={value} /> : null;
}
