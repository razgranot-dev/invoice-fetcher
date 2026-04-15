import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div>
        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-primary bg-clip-text text-transparent">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1.5 font-medium">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-3 mt-4 sm:mt-0">{children}</div>}
    </div>
  );
}
