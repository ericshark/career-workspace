import type { Metadata } from "next";
import { GeistSans as geist } from "geist/font/sans";
import { GeistMono as geistMono } from "geist/font/mono";
import { AppShell } from "@/components/AppShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = { title: "Career Workspace" };

// Geist is self-hosted by next/font and exposed as the --font-sans / --font-mono tokens.

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html> before React hydrates.
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
        <ThemeProvider>
          <TooltipProvider>
            <AppShell>{children}</AppShell>
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
