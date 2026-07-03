import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  apiRoutes,
  flattenApiRoutes,
  routePatternToRegExp,
} from "../../packages/contracts/dist/index.js";

const repoRoot = new URL("../..", import.meta.url).pathname;
const consumedPackages = [
  "packages/client-js/src",
  "packages/mcp/src",
  "packages/channel-intelligence/src",
];
const apiControllerRoot = join(repoRoot, "apps/api/src");

function filesUnder(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...filesUnder(p, predicate));
    else if (predicate(p)) out.push(p);
  }
  return out;
}

function extractLiteralV1Paths(text) {
  const paths = new Set();
  const re = /['"`]([^'"`]*\/v1\/[^'"`]*)/g;
  let match;
  while ((match = re.exec(text))) {
    const raw = match[1];
    const path = raw
      .slice(raw.indexOf("/v1/"))
      .split("?")[0]
      .replace(/\$\{[^}]+\}/g, ":id")
      .replace(/encodeURIComponent\([^)]*\)/g, ":id");
    paths.add(path);
  }
  return [...paths].sort();
}

function extractApiRoutesFromControllers() {
  const found = new Set();
  for (const file of filesUnder(apiControllerRoot, (p) =>
    p.endsWith(".controller.ts"),
  )) {
    const text = readFileSync(file, "utf8");
    const controllerMatches = [
      ...text.matchAll(/@Controller\((['"])(.*?)\1\)/g),
    ];
    const controllerBase = controllerMatches.at(-1)?.[2] ?? "";
    const methodRe = /@(Get|Post|Patch|Delete)\((?:(['"])(.*?)\2)?\)/g;
    let match;
    while ((match = methodRe.exec(text))) {
      const method = match[1].toUpperCase();
      const suffix = match[3] ?? "";
      const path =
        `/${[controllerBase, suffix].filter(Boolean).join("/")}`.replace(
          /\/+/g,
          "/",
        );
      found.add(`${method} ${path.replace(/:([A-Za-z0-9_]+)/g, ":id")}`);
    }
  }
  return found;
}

const contractedRoutes = flattenApiRoutes();
const knownRoutePatterns = contractedRoutes.map((route) => ({
  ...route,
  regexp: routePatternToRegExp(route.path),
}));

describe("package route contracts", () => {
  it("covers every hardcoded /v1 route consumed by package clients", () => {
    const unknown = [];
    for (const dir of consumedPackages) {
      for (const file of filesUnder(join(repoRoot, dir), (p) =>
        p.endsWith(".ts"),
      )) {
        const text = readFileSync(file, "utf8");
        for (const path of extractLiteralV1Paths(text)) {
          if (!knownRoutePatterns.some((route) => route.regexp.test(path))) {
            unknown.push(`${relative(repoRoot, file)} -> ${path}`);
          }
        }
      }
    }
    assert.deepEqual(unknown, []);
  });

  it("has backing API controller routes for every package-consumed contract", () => {
    const apiRoutesFound = extractApiRoutesFromControllers();
    const missing = contractedRoutes
      .filter((route) => route.consumers.length > 0)
      .map(
        (route) =>
          `${route.method} ${route.path.replace(/:([A-Za-z0-9_]+)/g, ":id")}`,
      )
      .filter((route) => !apiRoutesFound.has(route));
    assert.deepEqual(missing, []);
  });

  it("records the canonical routes for known prior drift points", () => {
    assert.equal(apiRoutes.observe.create.path, "/v1/observe");
    assert.equal(apiRoutes.stats.dashboard.path, "/v1/stats");
  });
});
