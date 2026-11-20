"use client";
import { useSyncExternalStore } from "react";
import { Kbd } from "@/components/ui/kbd";

const noSubscribe = () => () => {};
const isApple = () => /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The submit shortcut hint: ⌘↵ on Apple devices, Ctrl↵ elsewhere (the handlers accept both). The
 * server render can't know the platform, so it shows Ctrl and the client corrects it after hydration.
 */
export function SubmitShortcut() {
  const apple = useSyncExternalStore(noSubscribe, isApple, () => false);
  return (
    <Kbd className="bg-primary-foreground/20 text-current">
      {apple ? "⌘↵" : "Ctrl ↵"}
    </Kbd>
  );
}
