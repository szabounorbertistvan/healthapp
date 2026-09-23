/**
 * Placeholder shapes for the social screens while their reads are in flight —
 * the layout arrives first, so nothing jumps when the rows land. Pure markup:
 * no data, no client JavaScript.
 */
function Bar({ className }: { className: string }) {
  return <span className={`block animate-pulse rounded-full bg-surface ${className}`} />;
}

/** A list of people or notifications: avatar, two lines, a pill. */
export function ListSkeleton({ rows = 6, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true">
      {title ? <Bar className="h-8 w-48" /> : null}
      <Bar className="mt-5 h-[42px] w-full rounded-2xl" />
      <ul className="mt-4 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex items-center gap-3 rounded-2xl bg-surface/60 px-4 py-3.5">
            <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-bg" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-bg" />
              <span className="block h-3 w-3/5 animate-pulse rounded-full bg-bg" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A profile: header card, a stat row, then a couple of post shapes. */
export function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true">
      <Bar className="h-9 w-24" />
      <div className="mt-4 rounded-3xl bg-surface/60 p-5">
        <div className="flex items-center gap-4">
          <span className="h-16 w-16 shrink-0 animate-pulse rounded-full bg-bg" />
          <span className="flex-1 space-y-2">
            <span className="block h-6 w-1/2 animate-pulse rounded-full bg-bg" />
            <span className="block h-3.5 w-1/3 animate-pulse rounded-full bg-bg" />
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <span key={i} className={`h-[60px] animate-pulse rounded-2xl bg-bg ${i > 2 ? "hidden sm:block" : ""}`} />
          ))}
        </div>
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="mt-4 h-48 animate-pulse rounded-3xl bg-surface/60" />
      ))}
    </div>
  );
}
