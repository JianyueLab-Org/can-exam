import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import {
  buildTrainingDivisions,
  curriculumHref,
  findCurriculum,
  materialHref,
  resolveGroups,
} from "./training";

const ids = readdirSync("src/content/training/jpn").map(
  (file) => `jpn/${file.replace(/\.mdx$/, "")}`,
);

describe("training hrefs", () => {
  test("live under /training on this site", () => {
    const jpn = findCurriculum("jpn")!;
    expect(curriculumHref(jpn)).toBe("/training/jpn");
    expect(materialHref(jpn, jpn.materials[0])).toBe(
      `/training/jpn/${jpn.materials[0].id}`,
    );
  });
});

describe("buildTrainingDivisions", () => {
  test("five divisions, JPN published with every material", () => {
    const divisions = buildTrainingDivisions(ids);
    expect(divisions.map((d) => d.region)).toEqual([1, 2, 3, 4, 5]);
    const jpn = divisions.find((d) => d.region === 3)!;
    expect(jpn.href).toBe("/training/jpn");
    expect(jpn.materialCount).toBe(ids.length - 1); // overview excluded
  });

  test("ROC has no curriculum and stays unpublished", () => {
    const roc = buildTrainingDivisions(ids).find((d) => d.region === 5)!;
    expect(roc).toEqual({ region: 5 });
  });
});

describe("resolveGroups", () => {
  test("every grouped id has its MDX", () => {
    const jpn = findCurriculum("jpn")!;
    const listed = new Set(jpn.groups.flatMap((g) => g.items));
    const resolved = new Set(
      resolveGroups(jpn, ids).flatMap((g) => g.materials.map((m) => m.id)),
    );
    expect(resolved).toEqual(listed);
  });
});
