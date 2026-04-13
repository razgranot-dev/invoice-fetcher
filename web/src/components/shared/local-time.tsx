"use client";

interface LocalTimeProps {
  date: string | Date;
  format?: Intl.DateTimeFormatOptions;
  className?: string;
}

const defaultFormat: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export function LocalTime({ date, format, className }: LocalTimeProps) {
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={d.toISOString()} className={className}>
      {d.toLocaleDateString("en-US", format ?? defaultFormat)}
    </time>
  );
}
