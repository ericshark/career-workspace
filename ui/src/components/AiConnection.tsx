"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Status = {
  mode: "key" | "chatgpt";
  openAiKey: boolean;
  claudeKey: boolean;
  connected: boolean;
  email?: string;
};
export function AiConnection({ provider }: { provider: "openai" | "claude" }) {
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/ai-connection")
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setStatus(await r.json());
      })
      .catch(() => setError("Could not read AI connection settings."));
  }, []);
  async function change(action: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ai-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!r.ok) throw new Error();
      const next = await r.json();
      if (action === "connect") window.location.assign(next.url);
      else setStatus(next);
    } catch {
      setError("Could not update the AI connection. Try again.");
    } finally {
      setBusy(false);
    }
  }
  if (provider === "claude")
    return (
      <p>
        {status?.claudeKey
          ? "Using the Claude API key."
          : "Set ANTHROPIC_API_KEY in ui/.env.local and restart the app."}
      </p>
    );
  return (
    <>
      {status?.mode === "chatgpt" ? (
        <p>
          {status.connected
            ? `Using ChatGPT plan${status.email ? ` · ${status.email}` : ""}`
            : "Reconnect ChatGPT to use this mode."}
        </p>
      ) : (
        <p>
          {status?.openAiKey
            ? "Using the OpenAI API key."
            : "Set OPENAI_API_KEY in ui/.env.local and restart, or connect a ChatGPT plan."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void change("connect")}
        >
          Continue with ChatGPT
        </Button>
        {status?.connected && status.mode !== "chatgpt" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void change("chatgpt")}
          >
            Use ChatGPT plan
          </Button>
        )}
        {status?.mode === "chatgpt" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void change("key")}
          >
            Use OpenAI API key
          </Button>
        )}
        {status?.connected && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void change("disconnect")}
          >
            Disconnect ChatGPT
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
