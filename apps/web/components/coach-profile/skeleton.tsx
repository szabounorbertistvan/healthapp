/**
 * A section of /coaches/[slug] (programs, posts) while its reads stream in
 * for a signed-in reader. Not a route loading.tsx on purpose: a loading
 * boundary starts the response before the page can call notFound(), and an
 * unknown or private coach must stay a real 404. The same pulse bars as
 * social-skeleton.tsx; pure markup, no client JavaScript.
 */
function Bar({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-full bg-surface ${className}`} />;
}

export function CoachSectionSkeleton({ cards = 2 }: { cards?: number }) {
  return (
    <div aria-busy="true" data-testid="coach-section-skeleton">
      <Bar className="h-6 w-48" />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => <span key={i} className="block h-36 animate-pulse rounded-3xl bg-surface" />)}
      </div>
    </div>
  );
}
