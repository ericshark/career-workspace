export async function register() {
  // Startup only: building and importing data modules must never age live records.
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { ageApplications } = await import("./lib/maintenance");
    await ageApplications();
    // Dev servers a previous run of this server left behind (it crashed or was
    // killed) are stopped; this also starts the shutdown hooks.
    const { devProcesses } = await import("./lib/dev/processes");
    devProcesses().reapOrphans();
  }
}
