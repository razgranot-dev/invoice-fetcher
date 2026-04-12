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
  primary: "text-primary bg-primary/8 border-primary/12",
  secondary: "text-secondary bg-secondary/8 border-secondary/12",
  accent: "text-accent bg-accent/8 border-accent/12",
  destructive: "text-destructive bg-destructive/8 border-destructive/12",
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
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card p-5",
        "transition-all duration-200 hover:border-border/80 hover:shadow-lg hover:shadow-black/20",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-lg border",
            accentMap[accentColor]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "font-medium",
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
