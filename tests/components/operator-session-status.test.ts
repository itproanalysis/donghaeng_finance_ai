import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  authenticatedFetch: vi.fn(),
  cleanup: undefined as (() => void) | undefined,
  currentPath: "/login",
  effectDependencies: undefined as readonly unknown[] | undefined,
  hookIndex: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect(
      effect: () => void | (() => void),
      dependencies?: readonly unknown[],
    ) {
      const changed =
        dependencies === undefined ||
        harness.effectDependencies === undefined ||
        dependencies.length !== harness.effectDependencies.length ||
        dependencies.some(
          (dependency, index) => !Object.is(dependency, harness.effectDependencies?.[index]),
        );
      if (!changed) return;

      harness.cleanup?.();
      harness.effectDependencies = dependencies ? [...dependencies] : undefined;
      const cleanup = effect();
      harness.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    },
    useState<T>(initialValue: T) {
      const index = harness.hookIndex;
      harness.hookIndex += 1;
      if (harness.stateValues.length <= index) {
        harness.stateValues[index] = initialValue;
      }
      const setValue = (nextValue: T | ((previous: T) => T)) => {
        const previous = harness.stateValues[index] as T;
        harness.stateValues[index] =
          typeof nextValue === "function"
            ? (nextValue as (value: T) => T)(previous)
            : nextValue;
      };
      return [harness.stateValues[index] as T, setValue] as const;
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => harness.currentPath,
}));

vi.mock("@/components/api-adapter", () => ({
  isPublicReviewBrowser: () => false,
  authenticatedFetch: harness.authenticatedFetch,
  readApiEnvelope: (value: unknown) => value,
}));

import { OperatorSessionStatus } from "../../src/components/operator-session-status";

function renderAt(pathname: string) {
  harness.currentPath = pathname;
  harness.hookIndex = 0;
  return OperatorSessionStatus();
}

describe("OperatorSessionStatus", () => {
  beforeEach(() => {
    harness.cleanup?.();
    harness.authenticatedFetch.mockReset();
    harness.cleanup = undefined;
    harness.currentPath = "/login";
    harness.effectDependencies = undefined;
    harness.hookIndex = 0;
    harness.stateValues.length = 0;
  });

  it("로그인 화면의 401 상태를 App Router 이동 후 인증된 상담사 상태로 갱신한다", async () => {
    harness.authenticatedFetch.mockRejectedValueOnce(new Error("unauthorized"));

    renderAt("/login");
    await vi.waitFor(() => expect(harness.stateValues).toEqual([null, true]));

    harness.authenticatedFetch.mockResolvedValueOnce({
      principal: { displayName: "동행 상담사" },
    });
    renderAt("/interviews/interview-1");

    await vi.waitFor(() => {
      expect(harness.stateValues).toEqual(["동행 상담사", false]);
    });
    expect(harness.authenticatedFetch).toHaveBeenCalledTimes(2);
  });
});
