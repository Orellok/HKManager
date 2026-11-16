"use client";

import { Button } from "@/components/button";

/** Shown when a clients screen could not load its data. Details stay in the server log. */
export default function ClientsError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <section role="alert" className="space-y-3">
      <h1 className="text-2xl font-semibold">לא הצלחנו לטעון את הלקוחות</h1>
      <p className="text-muted-foreground">ייתכן שיש בעיית חיבור. אפשר לנסות שוב.</p>
      <Button onClick={() => retry()}>ניסיון חוזר</Button>
    </section>
  );
}
