import { requireAllowedUser } from "@/lib/auth/guards";
import { updateClientAction } from "@/lib/clients/actions";
import { clientPath } from "@/lib/clients/paths";
import type { ClientFormValues } from "@/lib/clients/schema";

import { ClientForm } from "../../client-form";
import { loadClientOrNotFound } from "../load-client";

/** CLI-1: edit a client's details. */
export default async function EditClientPage({ params }: PageProps<"/clients/[id]/edit">) {
  await requireAllowedUser();
  const client = await loadClientOrNotFound(params);
  const initialValues: ClientFormValues = {
    name: client.name,
    phone: client.phone ?? "",
    email: client.email ?? "",
    address: client.address ?? "",
    notes: client.notes ?? "",
  };

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">עריכת לקוח</h1>
      <ClientForm
        action={updateClientAction.bind(null, client.id)}
        initialValues={initialValues}
        clientId={client.id}
        submitLabel="שמירת שינויים"
        cancelHref={clientPath(client.id)}
      />
    </section>
  );
}
