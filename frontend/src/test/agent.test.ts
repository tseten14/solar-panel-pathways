import { describe, it, expect } from "vitest";
import { parseSseChunk, normalizeConfirmation } from "@/agent/useAgentChat";

describe("parseSseChunk", () => {
  it("reads a complete event", () => {
    const { events, rest } = parseSseChunk('event: done\ndata: {"sessionId":"a"}\n\n');
    expect(events).toEqual([{ event: "done", data: '{"sessionId":"a"}' }]);
    expect(rest).toBe("");
  });

  it("reads several events from one chunk", () => {
    const raw =
      'event: tool_start\ndata: {"tool":"fly_to"}\n\n' +
      'event: assistant_delta\ndata: {"text":"hi"}\n\n';
    const { events } = parseSseChunk(raw);
    expect(events.map((e) => e.event)).toEqual(["tool_start", "assistant_delta"]);
  });

  it("holds back a partial event for the next chunk", () => {
    // A network chunk can split mid-event; the tail must survive to be
    // re-parsed, or tokens go missing from the reply.
    const first = parseSseChunk('event: assistant_delta\ndata: {"text":"a"}\n\nevent: assis');
    expect(first.events).toHaveLength(1);
    expect(first.rest).toBe("event: assis");

    const second = parseSseChunk(`${first.rest}tant_delta\ndata: {"text":"b"}\n\n`);
    expect(second.events).toEqual([{ event: "assistant_delta", data: '{"text":"b"}' }]);
  });

  it("ignores blocks with no data line", () => {
    expect(parseSseChunk(": keep-alive\n\n").events).toEqual([]);
  });

  it("defaults the event name to message", () => {
    expect(parseSseChunk('data: {"x":1}\n\n').events[0].event).toBe("message");
  });
});

describe("normalizeConfirmation", () => {
  it("maps the backend's snake_case payload", () => {
    expect(
      normalizeConfirmation({
        action_id: "abc",
        tool: "erase_in_circle",
        summary: "Erase 3 detections?",
        impact: { detections: 3 },
      }),
    ).toEqual({
      actionId: "abc",
      tool: "erase_in_circle",
      summary: "Erase 3 detections?",
      impact: { detections: 3 },
    });
  });

  it("falls back to a readable prompt when the summary is missing", () => {
    const result = normalizeConfirmation({ action_id: "x", tool: "reject_detections" });
    expect(result.summary).toBe("Confirm this action?");
    expect(result.impact).toBeUndefined();
  });
});
