import { expect, it } from "vitest";
import {
  appointmentEnd,
  appointmentState,
  type RecruitingEvent,
} from "@/lib/recruitingTypes";
const event = (
  scheduledAt: string,
  extra: Partial<RecruitingEvent> = {},
): RecruitingEvent => ({
  id: "a",
  applicationKey: "app",
  kind: "interview",
  at: "2026-10-01T12:00:00Z",
  title: "Interview",
  description: "",
  notify: true,
  seen: false,
  scheduledAt,
  ...extra,
});
it("uses an actual end instead of inventing a duration", () => {
  const e = event("2026-11-17T15:00:00Z", {
    scheduledEndAt: "2026-11-17T15:45:00Z",
  });
  expect(appointmentState(e, new Date("2026-11-17T15:44:59Z"))).toBe(
    "Upcoming",
  );
  expect(appointmentState(e, new Date("2026-11-17T15:45:00Z"))).toBe(
    "Completed",
  );
});
it("ends date-only appointments at New York midnight on both DST transition days", () => {
  expect(new Date(appointmentEnd(event("2026-03-08"))).toISOString()).toBe(
    "2026-03-09T04:00:00.000Z",
  );
  expect(new Date(appointmentEnd(event("2026-11-01"))).toISOString()).toBe(
    "2026-11-02T05:00:00.000Z",
  );
});
it("cancellation overrides elapsed time", () => {
  expect(
    appointmentState(
      event("2026-01-01", { appointment: { id: "a", cancelled: true } }),
    ),
  ).toBe("Cancelled");
});
