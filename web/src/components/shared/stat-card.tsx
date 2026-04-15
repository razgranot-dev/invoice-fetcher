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
    icon: "text-primary bg-primary/10 border-primary/20 shadow-lg shadow-primary/10",
    strip: "accent-strip-primary",
    glow: "group-hover:shadow-primary/15",
  },
  secondary: {
    icon: "text-secondary bg-secondary/10 border-secondary/20 shadow-lg shadow-secondary/10",
    strip: "accent-strip-green",
    glow: "group-hover:shadow-secondary/15",
  },
  accent: {
    icon: "text-accent bg-accent/10 border-accent/20 shadow-lg shadow-accent/10",
    strip: "accent-strip-amber",
    glow: "group-hover:shadow-accent/15",
  },
  destructive: {
    icon: "text-destructive bg-destructive/10 border-destructive/20 shadow-lg shadow-destructive/10",
    strip: "accent-strip-primary",
    glow: "group-hover:shadow-destructive/15",
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
        "card-glow group relative p-6 hover-lift",
        accent.strip,
        accent.glow,
        className
      )}
    >
      <div className="relative flex items-start justify-between">
        <div className="space-y-2.5">
          <p className="text-[11px] font-bold text-muted-foreground tracking-[0.15em] uppercase">
            {label}
          </p>
          <p className="text-4xl font-black tracking-tight text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground font-medium">{subtitle}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl border",
            accent.icon
          )}
        >
          <Icon className="h-5.5 w-5.5" />
        </div>
      </div>
      {trend && (
        <div className="relative mt-4 flex items-center gap-2 text-xs">
          <span
            className={cn(
              "font-bold px-2 py-0.5 rounded-md",
              trend.value >= 0 ? "text-secondary bg-secondary/10" : "text-destructive bg-destructive/10"
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
