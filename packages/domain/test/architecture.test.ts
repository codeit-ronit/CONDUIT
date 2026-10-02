import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(import.meta.dirname, "../src");
const forbiddenImport = /from\s+["'](?:node:|@conduit\/|[^./])/gu;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return extname(entry.name) === ".ts" ? [path] : [];
  });
}

describe("domain architecture", () => {
  it("does not import I/O, frameworks, infrastructure, or external packages", () => {
    const violations = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const matches = [...source.matchAll(forbiddenImport)].map((match) => match[0]);

      return matches.map((match) => `${relative(sourceRoot, path)}: ${match}`);
    });

    expect(violations).toEqual([]);
  });
});
