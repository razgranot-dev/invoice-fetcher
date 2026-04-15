export default function ScansLoading() {
  return (
    <div className="space-y-8 animate-in">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-20 rounded-lg shimmer" />
          <div className="h-4 w-52 rounded-lg shimmer" />
        </div>
        <div className="h-8 w-28 rounded-xl shimmer" />
      </div>
      <div className="rounded-2xl border border-border/40 bg-card/50 overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-border/20">
            <div className="h-10 w-10 rounded-xl shimmer" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-44 rounded shimmer" />
              <div className="h-3 w-64 rounded shimmer" />
            </div>
            <div className="h-6 w-24 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
