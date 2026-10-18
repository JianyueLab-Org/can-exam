import { describe, expect, test } from "bun:test";
import { examNav, navPathname } from "./nav";

const t = (key: string) => key;

describe("examNav", () => {
  test("signed out: exams and training", () => {
    expect(examNav(t, null).map((i) => i.href)).toEqual(["/", "/training"]);
  });
  test("below I1: no question bank", () => {
    const m = { username: "1", name: "", rating: 7 };
    expect(examNav(t, m).map((i) => i.href)).toEqual(["/", "/training"]);
  });
  test("I1 and above: question bank last", () => {
    const m = { username: "1", name: "", rating: 8 };
    expect(examNav(t, m).map((i) => i.href)).toEqual([
      "/",
      "/training",
      "/admin",
    ]);
  });
});

describe("navPathname", () => {
  test("sit pages light up Exams", () => {
    expect(navPathname("/sit/new-member")).toBe("/");
  });
  test("training and admin keep their own path", () => {
    expect(navPathname("/training/jpn")).toBe("/training/jpn");
    expect(navPathname("/admin/3")).toBe("/admin/3");
  });
});
