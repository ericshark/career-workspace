import { expect, type Page } from "@playwright/test";

export async function submitAndOpenReview(page: Page) {
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/score") &&
      response.request().method() === "POST" &&
      response.status() === 202,
  );
  await page.getByRole("button", { name: /Review job/ }).click();
  const { runId } = await (await accepted).json();
  await expect(
    page.locator(`#completed-review[data-review-id="${runId}"]`),
  ).toBeVisible();
  return runId as string;
}
