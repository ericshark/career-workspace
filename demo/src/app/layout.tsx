import type { Metadata } from "next";
import { GeistSans as geist } from "geist/font/sans";
import { GeistMono as geistMono } from "geist/font/mono";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Runtime } from "@demo/Runtime";
import { Tour } from "@demo/Tour";
import "./globals.css";

export const metadata: Metadata = {
  title: "Career Workspace demo",
  description:
    "Try Career Workspace, a local job search app, in your browser with fictional data.",
};

// Mirrors ui/src/app/layout.tsx, plus the demo runtime and tour.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={cn(
        geist.variable,
        geistMono.variable,
        "[--font-sans:var(--font-geist-sans)] [--font-mono:var(--font-geist-mono)]",
      )}
      suppressHydrationWarning
    >
      <body className="min-h-screen">
        <Runtime />
        <ThemeProvider>
          <TooltipProvider>
            <AppShell>
              <Tour>{children}</Tour>
            </AppShell>
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
