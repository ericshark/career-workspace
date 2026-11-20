import { afterEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
vi.mock("@/lib/applications", () => ({
  readApplications: async () => ({ readOnly: null }),
}));
vi.mock("@/lib/preferences", () => ({
  readPreferences: () => ({ provider: "openai" }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each(["", "test-key-never-expose"])(
  "reports API key presence without making a provider call",
  async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    const fetch = vi.spyOn(globalThis, "fetch");
    const body = await (await GET()).json();
    expect(body.connected).toBe(Boolean(key));
    expect(JSON.stringify(body)).not.toContain("test-key-never-expose");
    expect(fetch).not.toHaveBeenCalled();
  },
);
