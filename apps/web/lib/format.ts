export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export const signalLabel = {
  on_track: "On Track",
  needs_attention: "Needs Attention",
  at_risk: "At Risk",
} as const;
