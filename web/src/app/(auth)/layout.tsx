export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 relative">
      {/* Ambient aurora glow for login */}
      <div className="pointer-events-none absolute inset-0 aurora-bg opacity-40" />
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/5 blur-[120px]" />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
