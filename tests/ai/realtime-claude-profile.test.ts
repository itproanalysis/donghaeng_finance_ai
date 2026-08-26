import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const launcher = readFileSync(
  new URL("../../Start-Donghaeng-AI-Claude.cmd", import.meta.url),
  "utf8",
);
const workspaceScript = readFileSync(
  new URL("../../scripts/start-local-workspace.ps1", import.meta.url),
  "utf8",
);

describe("one-click realtime Claude profile", () => {
  it("pins Sonnet 5 by default and keeps Haiku behind an explicit fast comparison flag", () => {
    expect(launcher).toContain(
      'set "DONGHAENG_ANTHROPIC_MODEL=claude-sonnet-5"',
    );
    expect(launcher).toContain('"--fast"');
    expect(launcher).toContain(
      'set "DONGHAENG_ANTHROPIC_MODEL=claude-haiku-4-5-20251001"',
    );
  });

  it("records and revalidates the bounded profile before reusing a server", () => {
    expect(workspaceScript).toContain(
      '$approvedClaudeModels = @("claude-haiku-4-5-20251001", "claude-sonnet-5")',
    );
    expect(workspaceScript).toContain(
      '$orchestratorSoftDeadlineMs = if ($orchestratorModel -eq "claude-sonnet-5")',
    );
    expect(workspaceScript).toContain("        8000");
    expect(workspaceScript).toContain(
      '$orchestratorMaxTokens = if ($launchMode -eq "claude") { 2304 }',
    );
    expect(workspaceScript).toContain(
      '[string]$existingState.orchestratorProfile -ne $orchestratorProfile',
    );
    expect(workspaceScript).toContain(
      'orchestratorSoftDeadlineMs = $orchestratorSoftDeadlineMs',
    );
    expect(workspaceScript).toContain(
      'orchestratorMaxTokens = $orchestratorMaxTokens',
    );
  });
});
