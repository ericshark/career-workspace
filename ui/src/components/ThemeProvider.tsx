"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Light and dark only. The class goes on <html> before first paint (no flash); with nothing saved,
// the system setting decides. The storage key is the one the old toggle used, so saved choices carry over.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      storageKey="career-ui.theme"
      themes={["light", "dark"]}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
