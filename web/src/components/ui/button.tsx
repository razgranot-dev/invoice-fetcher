import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-wide transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-br from-primary via-primary to-[#5a4bd6] text-primary-foreground shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:scale-[0.97] shine-sweep",
        secondary:
          "bg-white/80 backdrop-blur-sm text-foreground border border-border/80 shadow-sm hover:border-primary/25 hover:bg-white hover:shadow-md hover:shadow-primary/8 active:scale-[0.97]",
        outline:
          "border border-border/70 bg-white/50 backdrop-blur-sm hover:bg-primary/5 hover:border-primary/30 hover:shadow-md hover:shadow-primary/8 active:scale-[0.97]",
        ghost: "hover:bg-muted/60 hover:text-foreground hover:shadow-sm",
        destructive:
          "bg-gradient-to-br from-destructive to-[#c0392b] text-destructive-foreground shadow-lg shadow-destructive/20 hover:shadow-xl hover:shadow-destructive/30 hover:-translate-y-0.5 active:scale-[0.97] shine-sweep",
        link: "text-primary underline-offset-4 hover:underline",
        glow: "bg-gradient-to-br from-[#7c6cf0] via-primary to-[#5a4bd6] text-primary-foreground shadow-xl shadow-primary/25 hover:shadow-2xl hover:shadow-primary/40 hover:-translate-y-1 active:scale-[0.97] animate-glow-pulse shine-sweep",
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
