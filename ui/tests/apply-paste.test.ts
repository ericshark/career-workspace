import { describe, expect, it } from "vitest";
import {
  compressPastedText,
  pastedUrl,
  splitJobPaste,
} from "@/components/applyHelpers";

describe("compressPastedText", () => {
  it("drops blank and whitespace-only lines and keeps line order", () => {
    expect(
      compressPastedText(
        "Acme — Engineer\r\n\r\n   \r\nAbout us\n\n\n\t\nBuild   things  well  \n",
      ),
    ).toBe("Acme — Engineer About us Build things well");
  });

  it("folds words pasted one per line onto the line above, keeping long lines separate", () => {
    const long =
      "We are hiring an engineer to build data products for customers";
    expect(
      compressPastedText(`${long}\nPython\n\nSQL\nAWS\n${long}\nRemote`),
    ).toBe(`${long} Python SQL AWS\n${long} Remote`);
  });

  it("leaves already compact text alone", () => {
    expect(
      compressPastedText("One two three four five\nSix seven eight nine ten"),
    ).toBe("One two three four five\nSix seven eight nine ten");
  });
});

describe("pastedUrl", () => {
  it("accepts a lone URL, adding https:// when the scheme is missing", () => {
    expect(pastedUrl("  https://boards.greenhouse.io/acme/jobs/9 \n")).toBe(
      "https://boards.greenhouse.io/acme/jobs/9",
    );
    expect(pastedUrl("linkedin.com/jobs/view/123")).toBe(
      "https://linkedin.com/jobs/view/123",
    );
  });

  it("rejects text that is more than a link", () => {
    expect(pastedUrl("Apply at https://acme.com/jobs today")).toBeNull();
    expect(pastedUrl("Engineer")).toBeNull();
    expect(pastedUrl("")).toBeNull();
  });
});

describe("splitJobPaste", () => {
  it("extracts recognized posting URLs and leaves non-posting company or EEO links in the text", () => {
    const withEeo =
      "Acme — Software Engineer\nSee https://acme.com/about and http://www.acme.com/resources/equal-employment-opportunity-is-the-law for details.";
    expect(splitJobPaste(withEeo)).toEqual({
      link: null,
      text: compressPastedText(withEeo),
    });

    const withPosting = `${withEeo}\nApply at https://boards.greenhouse.io/acme/jobs/42`;
    expect(splitJobPaste(withPosting)).toEqual({
      link: "https://boards.greenhouse.io/acme/jobs/42",
      text: compressPastedText(`${withEeo}\nApply at `),
    });
  });
});
