export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 relative light-mesh">
      {/* Primary glow orb */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/12 blur-[150px] animate-glow-pulse" />
      {/* Secondary glow */}
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-secondary/8 blur-[120px]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
