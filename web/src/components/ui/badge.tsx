import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary/12 text-primary border border-primary/20 shadow-sm shadow-primary/5",
        secondary: "bg-secondary/12 text-secondary border border-secondary/20 shadow-sm shadow-secondary/5",
        accent: "bg-accent/12 text-accent border border-accent/20 shadow-sm shadow-accent/5",
        destructive:
          "bg-destructive/12 text-destructive border border-destructive/20 shadow-sm shadow-destructive/5",
        outline: "border border-border/80 text-muted-foreground bg-muted/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
