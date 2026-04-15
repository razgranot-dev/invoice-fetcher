import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-wide transition-all duration-250 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-35 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-primary via-primary to-[#6340e0] text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/40 hover:brightness-115 active:scale-[0.96]",
        secondary:
          "bg-gradient-to-br from-muted/90 to-muted/60 text-foreground border border-border/80 hover:border-primary/25 hover:bg-muted hover:shadow-md hover:shadow-primary/5 active:scale-[0.96]",
        outline:
          "border border-border/70 bg-card/40 backdrop-blur-sm hover:bg-primary/8 hover:border-primary/30 hover:shadow-md hover:shadow-primary/10 active:scale-[0.96]",
        ghost: "hover:bg-muted/50 hover:text-foreground hover:shadow-sm",
        destructive:
          "bg-gradient-to-br from-destructive to-destructive/80 text-destructive-foreground shadow-lg shadow-destructive/25 hover:shadow-xl hover:shadow-destructive/40 hover:brightness-110 active:scale-[0.96]",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary/80",
        glow: "bg-gradient-to-br from-primary via-[#8b6aff] to-[#6340e0] text-primary-foreground shadow-xl shadow-primary/30 hover:shadow-2xl hover:shadow-primary/50 hover:brightness-115 hover:-translate-y-0.5 active:scale-[0.96] animate-glow-pulse",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-lg px-4 text-xs",
        lg: "h-12 rounded-xl px-8 text-base font-bold",
        icon: "h-10 w-10 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
