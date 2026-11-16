"use client";

import { Button } from "@/components/button";

/**
 * The body of a route's error boundary: the screen could not load its data. Details stay in
 * the server log. Failed actions on a loaded screen show inline errors instead.
 */
export function LoadError({ retry }: { retry: () => void }) {
  return (
    <section role="alert" className="space-y-3">
      <h1 className="text-2xl font-semibold">לא הצלחנו לטעון את הדף</h1>
      <p className="text-muted-foreground">ייתכן שיש בעיית חיבור. אפשר לנסות שוב.</p>
      <Button onClick={() => retry()}>ניסיון חוזר</Button>
    </section>
  );
}
