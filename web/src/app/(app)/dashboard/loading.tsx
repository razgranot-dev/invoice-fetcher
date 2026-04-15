export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-in">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-lg shimmer" />
          <div className="h-4 w-56 rounded-lg shimmer" />
        </div>
        <div className="h-9 w-28 rounded-xl shimmer" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 bg-card/50 p-5 space-y-3">
            <div className="flex justify-between">
              <div className="space-y-2">
                <div className="h-3 w-20 rounded shimmer" />
                <div className="h-8 w-24 rounded-lg shimmer" />
              </div>
              <div className="h-11 w-11 rounded-xl shimmer" />
            </div>
          </div>
        ))}
      </div>

      {/* List skeleton */}
      <div className="rounded-2xl border border-border/40 bg-card/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-border/40">
          <div className="h-4 w-32 rounded shimmer" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center justify-between px-6 py-3.5 border-b border-border/20">
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-40 rounded shimmer" />
              <div className="h-3 w-64 rounded shimmer" />
            </div>
            <div className="h-6 w-20 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
