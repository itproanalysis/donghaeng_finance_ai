import { describe, expect, it } from "vitest";
import { safeLoginReturnPath } from "../../src/domain/login-return-path";

describe("safe login return paths", () => {
  it.each(["/", "/borrower", "/borrower/interviews/abc", "/interviews?q=hello", "/interview-evaluations/abc#evidence"])("preserves %s", value => {
    expect(safeLoginReturnPath(value)).toBe(value);
  });
  it.each([undefined, null, "https://evil.example", "//evil.example", "/\\evil.example", "/login", "/api/admin/retention", "javascript:alert(1)", "/borrower\n", "/interviews/../../login", "/borrower/../api/admin/retention"])("rejects unsafe or looping path %s", value => {
    expect(safeLoginReturnPath(value)).toBe("/");
  });
});
