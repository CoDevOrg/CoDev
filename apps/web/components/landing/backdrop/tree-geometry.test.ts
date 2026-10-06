import { describe, expect, it } from "vitest";

import { buildTree } from "./tree-geometry";

describe("buildTree", () => {
  const tree = buildTree();

  it("is identical on every call so the page never reshuffles", () => {
    const again = buildTree();
    expect(again).toHaveLength(tree.length);
    expect(again[7]?.points[5]).toEqual(tree[7]?.points[5]);
  });

  it("forks into three levels of branches", () => {
    const depths = new Set(tree.map((line) => line.depth));
    expect(depths).toEqual(new Set([0, 1, 2]));
    expect(tree.filter((line) => line.depth === 0)).toHaveLength(34);
  });

  it("starts every child no earlier than the branch it grows from", () => {
    for (const line of tree) expect(line.start).toBeGreaterThanOrEqual(0);
    const primaryStarts = tree.filter((l) => l.depth === 0).map((l) => l.start);
    const childStarts = tree.filter((l) => l.depth > 0).map((l) => l.start);
    expect(Math.min(...childStarts)).toBeGreaterThan(
      Math.min(...primaryStarts),
    );
  });

  it("gives every branch a route that ends at its own tip", () => {
    for (const line of tree) {
      const tip = line.points.at(-1);
      const end = line.route.at(-1);
      expect(end?.x).toBeCloseTo(tip?.[0] ?? NaN);
      expect(end?.y).toBeCloseTo(tip?.[1] ?? NaN);
      // Own vertices sit at routeBase + index, so the route is long enough.
      expect(line.route.length).toBe(line.routeBase + line.points.length);
    }
  });

  it("routes every child back through its parent to the trunk", () => {
    for (const line of tree.filter((l) => l.depth > 0)) {
      const first = line.route[0];
      // Every route begins on a primary branch's origin, inside the trunk.
      expect(first?.y).toBeCloseTo(-0.09);
      expect(Math.abs(first?.x ?? 1)).toBeLessThanOrEqual(0.056);
      expect(line.routeBase).toBeGreaterThan(0);
    }
  });

  it("puts pulses on all primary and secondary branches", () => {
    for (const line of tree.filter((l) => l.depth < 2)) {
      expect(line.pulses.length).toBeGreaterThan(0);
    }
    const pulsing = tree.filter((l) => l.pulses.length > 0).length;
    expect(pulsing / tree.length).toBeGreaterThan(0.7);
  });
});
