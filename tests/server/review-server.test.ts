import { describe, expect, it } from "vitest";
// @ts-expect-error The review runtime is a dependency-free native Node module.
import { permittedReviewPath } from "../../scripts/review-server.mjs";

describe("public synthetic review boundary", () => {
  it("only allows the guide, two synthetic journeys, health and Next static assets", () => {
    for (const url of [
      "/",
      "/demo/borrower?_rsc=123",
      "/demo/admin",
      "/healthz",
      "/_next/static/chunks/app/demo/borrower/page-123.js",
    ])
      expect(permittedReviewPath("GET", url)).toBe(true);
  });
  it("rejects every real workflow, write request, path escape and websocket alternative", () => {
    for (const url of [
      "/api/interviews",
      "/api/auth/bootstrap",
      "/borrower",
      "/interviews",
      "/login",
      "/_next/../api/auth/me",
      "/demo%2fadmin",
      "//demo/admin",
      "/_next/static/../../api/interviews",
      "/demo/admin/../borrower",
      "/_next/image?url=/api/interviews",
    ])
      expect(permittedReviewPath("GET", url)).toBe(false);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
      expect(permittedReviewPath(method, "/demo/admin")).toBe(false);
  });
});
