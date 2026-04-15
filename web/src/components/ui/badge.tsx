import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-0.5 text-[11px] font-bold tracking-wider uppercase transition-all duration-200",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary border border-primary/25 shadow-md shadow-primary/10",
        secondary: "bg-secondary/15 text-secondary border border-secondary/25 shadow-md shadow-secondary/10",
        accent: "bg-accent/15 text-accent border border-accent/25 shadow-md shadow-accent/10",
        destructive:
          "bg-destructive/15 text-destructive border border-destructive/25 shadow-md shadow-destructive/10",
        outline: "border border-border/60 text-muted-foreground bg-muted/30 shadow-sm",
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
