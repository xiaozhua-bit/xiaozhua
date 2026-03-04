import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "./agent.js";
import { resetDatabase } from "../history/database.js";
import { createMessage } from "../history/messages.js";
import { createSession } from "../history/session.js";

describe("agent history tool-call restoration", () => {
  let testHome = "";

  beforeEach(async () => {
    testHome = mkdtempSync(join(tmpdir(), "xz-agent-test-"));
    process.env.XZ_HOME = testHome;
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
    rmSync(testHome, { recursive: true, force: true });
    delete process.env.XZ_HOME;
  });

  function buildInitialMessagesForSession(sessionId: string): Array<Record<string, unknown>> {
    const agent = createAgent({ sessionId }) as unknown as Record<string, unknown>;
    const model = (agent as { buildRuntimeModel: () => unknown }).buildRuntimeModel();
    return (agent as { buildInitialMessages: (_model: unknown) => Array<Record<string, unknown>> }).buildInitialMessages(model);
  }

  it("infers missing toolCallId from pending assistant tool call", () => {
    const session = createSession({ title: "restore-missing-id" });

    createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "bash",
            arguments: "{\"command\":\"echo ok\"}",
          },
        },
      ],
    });

    createMessage({
      sessionId: session.id,
      role: "tool",
      content: "ok",
      metadata: {
        toolName: "bash",
      },
    });

    const restored = buildInitialMessagesForSession(session.id);
    const toolResult = restored.find((msg) => msg.role === "toolResult");

    expect(toolResult).toBeTruthy();
    expect(toolResult?.toolCallId).toBe("call_abc");
    expect(toolResult?.toolName).toBe("bash");
  });

  it("drops unmatched tool results when no prior assistant tool call exists", () => {
    const session = createSession({ title: "orphan-tool-result" });

    createMessage({
      sessionId: session.id,
      role: "tool",
      content: "orphan",
      metadata: {
        toolCallId: "call_orphan",
        toolName: "bash",
      },
    });

    createMessage({
      sessionId: session.id,
      role: "user",
      content: "hello",
    });

    const restored = buildInitialMessagesForSession(session.id);
    const hasToolResult = restored.some((msg) => msg.role === "toolResult");

    expect(hasToolResult).toBe(false);
    expect(restored.some((msg) => msg.role === "user")).toBe(true);
  });

  it("repairs stale toolCallId by matching tool name", () => {
    const session = createSession({ title: "repair-stale-id" });

    createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call_new",
          type: "function",
          function: {
            name: "load_skill",
            arguments: "{\"name\":\"history-search\"}",
          },
        },
      ],
    });

    createMessage({
      sessionId: session.id,
      role: "tool",
      content: "loaded",
      metadata: {
        toolCallId: "call_old",
        toolName: "load_skill",
      },
    });

    const restored = buildInitialMessagesForSession(session.id);
    const toolResult = restored.find((msg) => msg.role === "toolResult");

    expect(toolResult).toBeTruthy();
    expect(toolResult?.toolCallId).toBe("call_new");
    expect(toolResult?.toolName).toBe("load_skill");
  });
});
