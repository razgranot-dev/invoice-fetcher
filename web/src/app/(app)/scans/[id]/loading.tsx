export default function ScanDetailLoading() {
  return (
    <div className="space-y-8 animate-in">
      <div className="h-8 w-20 rounded-lg shimmer" />
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-lg shimmer" />
        <div className="h-4 w-64 rounded-lg shimmer" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 bg-card/50 p-5 space-y-2">
            <div className="h-3 w-20 rounded shimmer" />
            <div className="h-7 w-16 rounded-lg shimmer" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border/40 bg-card/50 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-3.5 border-b border-border/20">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-40 rounded shimmer" />
              <div className="h-3 w-56 rounded shimmer" />
            </div>
            <div className="h-6 w-20 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
