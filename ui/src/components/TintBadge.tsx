import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Badge tinted with a data color (a status, score band or category token such as var(--success)):
 * the color for text on a 14% wash of itself, so it reads in both themes.
 */
export function TintBadge({
  color,
  className,
  style,
  ...props
}: React.ComponentProps<typeof Badge> & { color: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent", className)}
      style={{
        color,
        background: `color-mix(in oklch, ${color} 14%, transparent)`,
        ...style,
      }}
      {...props}
    />
  );
}
