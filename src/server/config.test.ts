import { afterEach, expect, test } from "bun:test";
import { signInUrl } from "./config";

const saved = {
  CAN_WEB_ORIGIN: process.env.CAN_WEB_ORIGIN,
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN,
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("carries the full current URL on the public origin", () => {
  process.env.CAN_WEB_ORIGIN = "https://ceruleanavi.net";
  process.env.PUBLIC_ORIGIN = "https://exam.ceruleanavi.net";
  expect(
    signInUrl(new URL("http://exam.internal:4321/sit/entry?token=abc")),
  ).toBe(
    `https://ceruleanavi.net/signin?callbackUrl=${encodeURIComponent(
      "https://exam.ceruleanavi.net/sit/entry?token=abc",
    )}`,
  );
});

test("drops the fragment and trims trailing slashes on origins", () => {
  process.env.CAN_WEB_ORIGIN = "http://localhost:4321/";
  process.env.PUBLIC_ORIGIN = "http://localhost:4325/";
  expect(signInUrl(new URL("http://localhost:4325/admin#top"))).toBe(
    `http://localhost:4321/signin?callbackUrl=${encodeURIComponent(
      "http://localhost:4325/admin",
    )}`,
  );
});
