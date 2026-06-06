import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Structural guard (Principle VI / FR-004): fulfillment is the ONLY writer of
// `status: FULFILLED`. No job, scheduler, or event handler may set it. We scan the source
// tree and assert the literal `FULFILLED` assignment appears only in the rewards service
// (the manual fulfill path) — never under src/jobs.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "generated") continue; // skip generated Prisma client
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Matches assigning the FULFILLED status, e.g. `status: "FULFILLED"`.
const FULFILLED_ASSIGN = /status:\s*["']FULFILLED["']/;

describe("no auto-fulfill (FR-004 / Principle VI)", () => {
  const files = walk(srcDir);

  it("only the rewards service writes status: FULFILLED", () => {
    const writers = files.filter((f) => FULFILLED_ASSIGN.test(fs.readFileSync(f, "utf-8")));
    const relative = writers.map((f) => path.relative(srcDir, f));
    expect(relative).toEqual(["modules/rewards/rewards.service.ts"]);
  });

  it("no job/worker/scheduler writes status: FULFILLED", () => {
    const jobWriters = files
      .filter((f) => f.includes(`${path.sep}jobs${path.sep}`))
      .filter((f) => FULFILLED_ASSIGN.test(fs.readFileSync(f, "utf-8")));
    expect(jobWriters).toEqual([]);
  });
});
