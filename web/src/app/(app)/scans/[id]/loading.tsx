export default function ScanDetailLoading() {
  return (
    <div className="space-y-8 animate-in">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl shimmer" />
        <div className="h-9 w-40 rounded-xl shimmer" />
        <div className="ml-auto h-6 w-24 rounded-lg shimmer" />
      </div>
      <div className="card-glow p-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-20 rounded shimmer" />
              <div className="h-5 w-28 rounded-lg shimmer" />
            </div>
          ))}
        </div>
      </div>
      <div className="card-glow overflow-hidden">
        <div className="px-6 py-4 border-b border-border/30">
          <div className="h-5 w-32 rounded shimmer" />
        </div>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-3.5 border-b border-border/20">
            <div className="h-9 w-9 rounded-xl shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-44 rounded shimmer" />
              <div className="h-3 w-60 rounded shimmer" />
            </div>
            <div className="h-6 w-20 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
