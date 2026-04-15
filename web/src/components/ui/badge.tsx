import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-0.5 text-[11px] font-bold tracking-wider uppercase transition-all duration-200",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary border border-primary/20 shadow-sm shadow-primary/8",
        secondary: "bg-secondary/10 text-secondary border border-secondary/20 shadow-sm shadow-secondary/8",
        accent: "bg-accent/10 text-accent border border-accent/20 shadow-sm shadow-accent/8",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/20 shadow-sm shadow-destructive/8",
        outline: "border border-border text-muted-foreground bg-muted/40 shadow-sm",
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
