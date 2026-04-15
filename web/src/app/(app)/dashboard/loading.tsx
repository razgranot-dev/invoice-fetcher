export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-in">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <div className="h-9 w-40 rounded-xl shimmer" />
          <div className="h-4 w-64 rounded-lg shimmer" />
        </div>
        <div className="h-10 w-32 rounded-xl shimmer" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 stagger">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card-glow p-6 space-y-4">
            <div className="flex justify-between">
              <div className="space-y-3">
                <div className="h-3 w-24 rounded shimmer" />
                <div className="h-10 w-28 rounded-xl shimmer" />
              </div>
              <div className="h-12 w-12 rounded-2xl shimmer" />
            </div>
          </div>
        ))}
      </div>

      {/* Bento list skeletons */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 card-glow overflow-hidden">
          <div className="px-6 py-4 border-b border-border/30">
            <div className="h-5 w-36 rounded shimmer" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-6 py-3.5 border-b border-border/20">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-44 rounded shimmer" />
                <div className="h-3 w-64 rounded shimmer" />
              </div>
              <div className="h-6 w-20 rounded-lg shimmer" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 card-glow overflow-hidden">
          <div className="px-6 py-4 border-b border-border/30">
            <div className="h-5 w-28 rounded shimmer" />
          </div>
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex items-center gap-3.5 px-6 py-3.5 border-b border-border/20">
              <div className="h-9 w-9 rounded-xl shimmer" />
              <div className="space-y-2 flex-1">
                <div className="h-4 w-36 rounded shimmer" />
                <div className="h-3 w-48 rounded shimmer" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
