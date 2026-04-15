import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-20 px-6 text-center animate-float-up",
        className
      )}
    >
      <div className="relative mb-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 border border-border/60 shadow-lg shadow-black/10">
          <Icon className="h-7 w-7 text-muted-foreground/70" />
        </div>
        <div className="absolute -inset-3 rounded-3xl bg-primary/5 blur-xl -z-10" />
      </div>
      <h3 className="text-base font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-7 leading-relaxed">
        {description}
      </p>
      {action && (
        <Button onClick={action.onClick} size="sm" variant="glow">
          {action.label}
        </Button>
      )}
    </div>
  );
}
