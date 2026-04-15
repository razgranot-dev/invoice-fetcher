import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
  accentColor?: "primary" | "secondary" | "accent" | "destructive";
}

const accentMap = {
  primary: {
    icon: "text-primary bg-primary/10 border-primary/15 shadow-primary/8",
    glow: "group-hover:shadow-primary/10",
  },
  secondary: {
    icon: "text-secondary bg-secondary/10 border-secondary/15 shadow-secondary/8",
    glow: "group-hover:shadow-secondary/10",
  },
  accent: {
    icon: "text-accent bg-accent/10 border-accent/15 shadow-accent/8",
    glow: "group-hover:shadow-accent/10",
  },
  destructive: {
    icon: "text-destructive bg-destructive/10 border-destructive/15 shadow-destructive/8",
    glow: "group-hover:shadow-destructive/10",
  },
};

export function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  accentColor = "primary",
}: StatCardProps) {
  const accent = accentMap[accentColor];
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-5",
        "transition-all duration-300 ease-out",
        "hover:border-border hover:shadow-xl hover:shadow-black/20",
        "hover:-translate-y-0.5",
        accent.glow,
        className
      )}
    >
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none aurora-bg" />

      <div className="relative flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-muted-foreground tracking-wide uppercase">
            {label}
          </p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground/80">{subtitle}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl border shadow-lg",
            accent.icon
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {trend && (
        <div className="relative mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "font-semibold",
              trend.value >= 0 ? "text-secondary" : "text-destructive"
            )}
          >
            {trend.value >= 0 ? "+" : ""}
            {trend.value}%
          </span>
          <span className="text-muted-foreground">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
