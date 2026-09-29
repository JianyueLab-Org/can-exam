import { expect, test } from "bun:test";
import { bankRefusal } from "./access";

const member = (rating: number) => ({ username: "1001", name: "Test", rating });

test("no refusal unless can-api answered 403", () => {
  expect(bankRefusal(member(2), 200, "x")).toBeNull();
  expect(bankRefusal(member(2), 502, "x")).toBeNull();
  expect(bankRefusal(member(2), 401, "x")).toBeNull();
});

test("below instructor: rating reason", () => {
  expect(bankRefusal(member(5), 403, "x")).toEqual({
    kind: "rating",
    required: 8,
  });
});

test("instructor with no division: permission reason", () => {
  expect(bankRefusal(member(8), 403, "所在分部的教员")).toEqual({
    kind: "permission",
    name: "所在分部的教员",
  });
});
