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
        "flex flex-col items-center justify-center py-24 px-6 text-center animate-float-up",
        className
      )}
    >
      <div className="relative mb-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/15 to-muted/30 border border-primary/20 shadow-2xl shadow-primary/15 animate-glow-pulse">
          <Icon className="h-9 w-9 text-primary/70" />
        </div>
        <div className="absolute -inset-6 rounded-full bg-primary/8 blur-2xl -z-10" />
      </div>
      <h3 className="text-xl font-bold mb-2.5">{title}</h3>
      <p className="text-sm text-muted-foreground/70 max-w-md mb-8 leading-relaxed">
        {description}
      </p>
      {action && (
        <Button onClick={action.onClick} size="lg" variant="glow">
          {action.label}
        </Button>
      )}
    </div>
  );
}
