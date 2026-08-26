import type { AsyncInterviewTurnPlanner } from "@/server/interview-service";

import {
  ClaudeProviderError,
  createAnthropicMessagesClientFromEnvironment,
  type AnthropicClientDependencies,
  type AnthropicRuntimeEnvironment,
} from "./anthropic-messages";
import { ClaudeInterviewTurnPlanner } from "./claude-interview-providers";

export interface ConfiguredInterviewProviderEnvironment
  extends AnthropicRuntimeEnvironment {
  DONGHAENG_ORCHESTRATOR_PROVIDER?: string;
  DONGHAENG_ANTHROPIC_SOFT_DEADLINE_MS?: string;
}

export interface ConfiguredInterviewProviderOptions
  extends AnthropicClientDependencies {
  environment?: ConfiguredInterviewProviderEnvironment;
  nodeEnvironment?: string;
}

function configurationError(message: string): ClaudeProviderError {
  return new ClaudeProviderError(
    "CLAUDE_CONFIGURATION_INVALID",
    message,
    false,
  );
}

/**
 * Local development remains reproducible by default. Production is fail-closed:
 * it must explicitly select the Anthropic provider and pass its server-only
 * credential through ANTHROPIC_API_KEY.
 */
export function createConfiguredAsyncInterviewTurnPlanner(
  options: ConfiguredInterviewProviderOptions = {},
): AsyncInterviewTurnPlanner | undefined {
  const environment =
    options.environment ??
    (process.env as ConfiguredInterviewProviderEnvironment);
  const nodeEnvironment = (
    options.nodeEnvironment ?? environment.NODE_ENV ?? ""
  )
    .trim()
    .toLowerCase();
  const production = nodeEnvironment === "production";
  const rawProvider = environment.DONGHAENG_ORCHESTRATOR_PROVIDER
    ?.trim()
    .toLowerCase();
  const provider = rawProvider || (production ? "" : "deterministic");

  if (provider === "deterministic") {
    if (production) {
      throw configurationError(
        "The deterministic interview orchestrator is forbidden in production.",
      );
    }
    return undefined;
  }
  if (!provider) {
    throw configurationError(
      "Production requires DONGHAENG_ORCHESTRATOR_PROVIDER=anthropic.",
    );
  }
  if (provider !== "anthropic") {
    throw configurationError(
      "DONGHAENG_ORCHESTRATOR_PROVIDER must be deterministic or anthropic.",
    );
  }

  const client = createAnthropicMessagesClientFromEnvironment(environment, {
    fetchImpl: options.fetchImpl,
  });
  const rawSoftDeadline = environment.DONGHAENG_ANTHROPIC_SOFT_DEADLINE_MS?.trim();
  const softDeadlineMs = rawSoftDeadline ? Number(rawSoftDeadline) : 8_000;
  if (!Number.isSafeInteger(softDeadlineMs) || softDeadlineMs < 250 || softDeadlineMs > 8_000) {
    throw configurationError(
      "DONGHAENG_ANTHROPIC_SOFT_DEADLINE_MS must be an integer between 250 and 8000.",
    );
  }
  return new ClaudeInterviewTurnPlanner(client, { softDeadlineMs });
}

/**
 * Validates production provider configuration without creating any database,
 * repository, or service singleton. Custom-server startup uses this guard so
 * the Next route bundle remains the sole owner of its InterviewService and
 * ApplicationError class graph.
 */
export function assertConfiguredInterviewProvider(
  options: ConfiguredInterviewProviderOptions = {},
): void {
  void createConfiguredAsyncInterviewTurnPlanner(options);
}
