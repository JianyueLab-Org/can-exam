import { describe, expect, test } from "bun:test";

import {
  canConfigurePromotion,
  paperProblem,
  type BankAuthority,
} from "./admin";

const authority = (overrides: Partial<BankAuthority> = {}): BankAuthority => ({
  global: false,
  regions: [1],
  promotionRegions: [1],
  maxGrant: 7,
  ...overrides,
});

const paper = (overrides: Record<string, unknown> = {}) => ({
  region: 1,
  promoteTo: 5,
  eligibleRatings: [1, 4],
  ...overrides,
});

describe("canConfigurePromotion", () => {
  test("requires the active director region", () => {
    expect(canConfigurePromotion(authority(), 1)).toBe(true);
    expect(canConfigurePromotion(authority(), 2)).toBe(false);
  });

  test("missing promotionRegions fails closed", () => {
    expect(canConfigurePromotion({ promotionRegions: undefined }, 1)).toBe(
      false,
    );
  });
});

describe("paperProblem", () => {
  test("allows no-promotion papers with any eligibility list", () => {
    expect(
      paperProblem(
        paper({ promoteTo: null, eligibleRatings: [] }),
        authority(),
      ),
    ).toBeNull();
  });

  test("requires source ratings for promotion papers", () => {
    expect(paperProblem(paper({ eligibleRatings: [] }), authority())).toBe(
      "eligible_rating_required",
    );
  });

  test("rejects promotion outside the configured region", () => {
    expect(paperProblem(paper({ region: 2 }), authority())).toBe(
      "promotion_forbidden",
    );
  });

  test("rejects unknown source ratings", () => {
    expect(paperProblem(paper({ eligibleRatings: [1, 99] }), authority())).toBe(
      "eligible_rating_unknown",
    );
  });

  test("rejects source ratings at or above the promotion target", () => {
    expect(paperProblem(paper({ eligibleRatings: [1, 5] }), authority())).toBe(
      "eligible_rating_too_high",
    );
  });
});
