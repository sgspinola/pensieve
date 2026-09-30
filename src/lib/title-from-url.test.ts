import { describe, expect, it } from "vitest";
import { titleFromUrl } from "@/lib/title-from-url";

describe("titleFromUrl", () => {
  it("de-slugifies an underscore-separated filename into a readable title", () => {
    expect(
      titleFromUrl(
        "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
      ),
    ).toBe("Authentication Cheat Sheet");
  });

  it("strips a .htm extension the same as .html", () => {
    expect(titleFromUrl("https://example.com/Some_Page.htm")).toBe("Some Page");
  });

  it("decodes percent-encoded characters in the last path segment", () => {
    expect(titleFromUrl("https://example.com/Caf%C3%A9_Menu")).toBe("Café Menu");
  });

  it("falls back to the hostname for a trailing-slash URL with no filename segment", () => {
    expect(titleFromUrl("https://kubernetes.io/docs/concepts/")).toBe("kubernetes.io");
  });

  it("falls back to the hostname for a bare origin URL", () => {
    expect(titleFromUrl("https://example.com/")).toBe("example.com");
  });

  it("leaves a filename with no underscores or extension unchanged", () => {
    expect(titleFromUrl("https://example.com/readme")).toBe("readme");
  });
});
