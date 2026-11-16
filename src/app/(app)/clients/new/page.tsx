import { requireAllowedUser } from "@/lib/auth/guards";
import { createClientAction } from "@/lib/clients/actions";
import { CLIENTS_PATH } from "@/lib/clients/paths";
import { EMPTY_CLIENT_FORM_VALUES } from "@/lib/clients/schema";

import { ClientForm } from "../client-form";

/** CLI-1: new client. */
export default async function NewClientPage() {
  await requireAllowedUser();

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">לקוח חדש</h1>
      <ClientForm
        action={createClientAction}
        initialValues={EMPTY_CLIENT_FORM_VALUES}
        clientId={null}
        submitLabel="שמירת לקוח"
        cancelHref={CLIENTS_PATH}
      />
    </section>
  );
}
