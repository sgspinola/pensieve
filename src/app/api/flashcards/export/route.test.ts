import { describe, expect, it } from "vitest";
import { EXPORT_FILENAME, buildExportHeaders } from "./route";

// GET /api/flashcards/export's own logic (ticket 05): the response headers
// that make this a browser download rather than an inline response. The
// export content itself is covered against a real database in
// src/services/flashcards/flashcards-export.test.ts — this route is thin,
// per this repo's route-test convention (see /api/flashcards/route.test.ts).
describe("buildExportHeaders", () => {
  it("sets a markdown content type and an attachment disposition with the export filename", () => {
    const headers = buildExportHeaders();
    expect(headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(headers["Content-Disposition"]).toBe(`attachment; filename="${EXPORT_FILENAME}"`);
  });
});
