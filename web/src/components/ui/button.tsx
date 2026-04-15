import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:brightness-110 active:scale-[0.97] active:shadow-sm",
        secondary:
          "bg-muted/80 text-foreground border border-border hover:bg-muted hover:border-border/80 active:scale-[0.97]",
        outline:
          "border border-border/80 bg-transparent hover:bg-muted/40 hover:border-primary/30 active:scale-[0.97]",
        ghost: "hover:bg-muted/40 hover:text-foreground",
        destructive:
          "bg-destructive/90 text-destructive-foreground shadow-sm shadow-destructive/20 hover:bg-destructive hover:shadow-md hover:shadow-destructive/30 active:scale-[0.97]",
        link: "text-primary underline-offset-4 hover:underline",
        glow: "bg-gradient-to-b from-primary to-primary/90 text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:brightness-110 active:scale-[0.97]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-lg px-3.5 text-xs",
        lg: "h-12 rounded-xl px-8 text-base font-semibold",
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
