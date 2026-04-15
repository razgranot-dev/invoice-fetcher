export default function InvoicesLoading() {
  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <div className="h-9 w-32 rounded-xl shimmer" />
          <div className="h-4 w-56 rounded-lg shimmer" />
        </div>
        <div className="flex gap-3">
          <div className="h-8 w-28 rounded-xl shimmer" />
          <div className="h-8 w-28 rounded-xl shimmer" />
        </div>
      </div>
      <div className="h-12 rounded-xl shimmer" />
      <div className="card-glow overflow-hidden">
        <div className="h-12 bg-gradient-to-r from-primary/5 to-transparent border-b border-border/30" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-3.5 border-b border-border/20">
            <div className="h-4.5 w-4.5 rounded-md shimmer" />
            <div className="h-7 w-7 rounded-lg shimmer" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-36 rounded shimmer" />
              <div className="h-3 w-56 rounded shimmer" />
            </div>
            <div className="h-4 w-16 rounded shimmer" />
            <div className="h-6 w-20 rounded-lg shimmer" />
          </div>
        ))}
      </div>
    </div>
  );
}
