/** Shown while a list screen loads. Keeps the layout stable and announces the wait. */
export function ListSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">טוען…</span>
      <div
        aria-hidden="true"
        className="bg-muted h-8 w-32 animate-pulse rounded-md motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="bg-muted h-11 w-full animate-pulse rounded-md motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="bg-muted h-40 w-full animate-pulse rounded-lg motion-reduce:animate-none"
      />
    </div>
  );
}
