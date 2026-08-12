import { describe, expect, it } from "vitest";

import { ClaudeInterviewTurnPlanner } from "../../src/ai/claude-interview-providers";
import {
  assertConfiguredInterviewProvider,
  createConfiguredAsyncInterviewTurnPlanner,
} from "../../src/ai/configured-interview-provider";

const TEST_API_KEY = `sk-ant-${"b".repeat(40)}`;

describe("configured interview orchestrator", () => {
  it("keeps deterministic planning as the explicit local-development default", () => {
    expect(
      createConfiguredAsyncInterviewTurnPlanner({
        nodeEnvironment: "development",
        environment: {},
      }),
    ).toBeUndefined();
    expect(
      createConfiguredAsyncInterviewTurnPlanner({
        nodeEnvironment: "test",
        environment: { DONGHAENG_ORCHESTRATOR_PROVIDER: "deterministic" },
      }),
    ).toBeUndefined();
  });

  it("constructs the async Claude planner only for the explicit anthropic provider", () => {
    const planner = createConfiguredAsyncInterviewTurnPlanner({
      nodeEnvironment: "production",
      environment: {
        NODE_ENV: "production",
        DONGHAENG_ORCHESTRATOR_PROVIDER: "anthropic",
        ANTHROPIC_API_KEY: TEST_API_KEY,
        DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
      },
    });
    expect(planner).toBeInstanceOf(ClaudeInterviewTurnPlanner);
    expect(() =>
      assertConfiguredInterviewProvider({
        nodeEnvironment: "production",
        environment: {
          NODE_ENV: "production",
          DONGHAENG_ORCHESTRATOR_PROVIDER: "anthropic",
          ANTHROPIC_API_KEY: TEST_API_KEY,
          DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
        },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      name: "missing production provider",
      nodeEnvironment: "production",
      environment: {},
    },
    {
      name: "deterministic production provider",
      nodeEnvironment: "production",
      environment: { DONGHAENG_ORCHESTRATOR_PROVIDER: "deterministic" },
    },
    {
      name: "unsupported provider",
      nodeEnvironment: "development",
      environment: { DONGHAENG_ORCHESTRATOR_PROVIDER: "other" },
    },
    {
      name: "missing Anthropic credential",
      nodeEnvironment: "production",
      environment: { DONGHAENG_ORCHESTRATOR_PROVIDER: "anthropic" },
    },
  ])("fails closed for $name", ({ nodeEnvironment, environment }) => {
    expect(() =>
      createConfiguredAsyncInterviewTurnPlanner({
        nodeEnvironment,
        environment,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "ClaudeProviderError",
        code: "CLAUDE_CONFIGURATION_INVALID",
        retryable: false,
      }),
    );
  });
});
