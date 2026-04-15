export default function ExportsLoading() {
  return (
    <div className="space-y-8 animate-in">
      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <div className="h-9 w-28 rounded-xl shimmer" />
          <div className="h-4 w-56 rounded-lg shimmer" />
        </div>
        <div className="h-10 w-32 rounded-xl shimmer" />
      </div>
      <div className="card-glow divide-y divide-border/20 overflow-hidden">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-5">
            <div className="h-11 w-11 rounded-xl shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-44 rounded shimmer" />
              <div className="h-3 w-64 rounded shimmer" />
            </div>
            <div className="h-8 w-28 rounded-xl shimmer" />
            <div className="h-6 w-20 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
