import { describe, expect, test } from "bun:test";
import { signOutTarget } from "./signOutTarget";

describe("signOutTarget", () => {
  test("pages that need sign-in go to can-web /", () => {
    for (const p of ["/sit/new-member", "/admin", "/admin/", "/admin/3"]) {
      expect(signOutTarget(p)).toBe("web");
    }
  });
  test("public pages reload", () => {
    for (const p of [
      "/",
      "/training",
      "/training/jpn",
      "/training/jpn/overview",
      "/administrator",
    ]) {
      expect(signOutTarget(p)).toBe("reload");
    }
  });
});
