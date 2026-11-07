import { describe, expect, it, vi } from "vitest";
import { readGenerationStream } from "./generationProgress";

function stream(text: string, chunk = 7) {
  const raw = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < raw.length; i += chunk) controller.enqueue(raw.slice(i, i + chunk));
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

describe("generation event stream", () => {
  it("delivers real stages before the result across split UTF-8 and CRLF frames", async () => {
    const progress = vi.fn();
    const result = await readGenerationStream(stream(': heartbeat\r\n\r\nevent: stage\r\ndata: {"stage":"pinecone","elapsed_ms":1600}\r\n\r\nevent: stage\r\ndata: {"stage":"generation","elapsed_ms":2000}\r\n\r\nevent: result\r\ndata: {"reply":"A small step 🌱"}\r\n\r\n', 1), progress);
    expect(progress.mock.calls.map(([event]) => event.stage)).toEqual(["pinecone", "generation"]);
    expect(result).toEqual({ reply: "A small step 🌱" });
  });
  it("refuses an incomplete stream and preserves explicit server errors", async () => {
    await expect(readGenerationStream(stream('event: stage\ndata: {"stage":"generation","elapsed_ms":0}\n\n'), vi.fn())).rejects.toThrow("before the result arrived");
    await expect(readGenerationStream(stream('event: error\ndata: {"status":409,"detail":"Context changed"}\n\n'), vi.fn())).rejects.toMatchObject({ status: 409, message: "Context changed" });
  });
});
