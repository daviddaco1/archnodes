import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// client/src/types/graph.ts is a hand-kept copy of this file (no shared package/workspace between
// the two — see CLAUDE.md). This test is the tripwire for drift: if someone edits one side and
// forgets the other, this fails with a readable diff instead of the mismatch surfacing later as a
// silent runtime bug in the client.
describe("client/src/types/graph.ts stays in sync with src/types/graph.ts", () => {
  it("matches byte-for-byte after stripping the client's own header comment", () => {
    const server = readFileSync(join(__dirname, "graph.ts"), "utf-8");
    const clientPath = join(__dirname, "..", "..", "client", "src", "types", "graph.ts");
    const clientRaw = readFileSync(clientPath, "utf-8");
    const clientLines = clientRaw.split("\n");
    // The client file carries a 3-line header explaining the manual-copy convention; the server
    // file has no such header, so strip it before comparing.
    const client = clientLines.slice(3).join("\n").replace(/^\n/, "");

    expect(client).toBe(server);
  });
});
