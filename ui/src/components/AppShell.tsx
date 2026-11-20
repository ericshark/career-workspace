"use client";
import { useState } from "react";
import Link from "next/link";
import { MenuIcon } from "lucide-react";
import { NavLinks } from "./NavLinks";
import { Settings } from "./Settings";
import { HeaderStatus } from "./HeaderStatus";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3" aria-label="Career home">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-mono text-xl text-primary-foreground">
        C
      </span>
      <span>
        <span className="block font-mono text-xl leading-none">Career</span>
      </span>
    </Link>
  );
}
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-card p-3 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r bg-sidebar px-4 py-5 lg:flex"
        aria-label="Main sidebar"
      >
        <Brand />
        <div className="mt-7">
          <NavLinks />
        </div>
        <div className="mt-auto space-y-5 border-t pt-5">
          <Settings />
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex min-h-12 items-center gap-3 border-b bg-header px-4 backdrop-blur-md lg:ml-56 lg:px-9">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label="Open navigation"
          onClick={() => setOpen(true)}
        >
          <MenuIcon />
        </Button>
        <span className="font-mono text-base lg:hidden">Career</span>
        <HeaderStatus />
        <span className="lg:hidden">
          <Settings />
        </span>
      </header>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="inset-y-0 left-0 h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none p-6 sm:max-w-72"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-full flex-col gap-8">
            <Brand />
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-auto">
              <Settings />
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <main
        id="main-content"
        className="min-w-0 px-4 py-5 sm:px-6 lg:ml-56 lg:px-7"
      >
        <div className="mx-auto max-w-[1440px]">{children}</div>
      </main>
    </div>
  );
}
