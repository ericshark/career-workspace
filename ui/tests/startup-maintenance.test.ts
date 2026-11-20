import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("@/lib/maintenance");
});
it("does not run maintenance during build or module import, but awaits Node startup", async () => {
  const ageApplications = vi.fn().mockResolvedValue(undefined);
  vi.doMock("@/lib/maintenance", () => ({ ageApplications }));
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  const { register } = await import("@/instrumentation");
  expect(ageApplications).not.toHaveBeenCalled();
  await register();
  expect(ageApplications).not.toHaveBeenCalled();
  vi.stubEnv("NEXT_PHASE", "phase-production-server");
  await register();
  expect(ageApplications).toHaveBeenCalledTimes(1);
});
