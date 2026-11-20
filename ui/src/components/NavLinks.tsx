"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useNavCounts } from "@/components/useNavCounts";
import {
  HouseIcon,
  PlusIcon,
  ListFilterIcon,
  BookOpenIcon,
  WrenchIcon,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: HouseIcon },
  { href: "/actions", label: "Actions", icon: ListFilterIcon },
  { href: "/apply", label: "Apply", icon: PlusIcon },
  { href: "/tracker", label: "Tracker", icon: ListFilterIcon },
  { href: "/workshop", label: "Workshop", icon: WrenchIcon },
  { href: "/docs", label: "Docs", icon: BookOpenIcon },
];

// Use a blue active state so navigation stands apart from the neutral surfaces.
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const counts = useNavCounts();
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1.5">
      {NAV.map((n) => {
        const count = counts[n.href] ?? 0;
        const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Button
            key={n.href}
            asChild
            variant="ghost"
            size="sm"
            className={`h-9 justify-start px-3 font-mono text-xs ${on ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground"}`}
          >
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
            >
              <n.icon className="mr-1 size-4" />
              {n.label}
              {count > 0 && (
                <span
                  className="ml-auto rounded-full bg-sidebar-accent px-1.5 font-mono text-[10px] leading-4 tabular-nums text-muted-foreground"
                  aria-label={`${count} ${n.href === "/" ? "updates" : "open"}`}
                >
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
