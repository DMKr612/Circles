export function Skeleton({ className="" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200/70 dark:bg-neutral-700/50 ${className}`} />;
}