/** The stream contains only fixed progress stages and a completed, validated result. */
export interface GenerationStage { stage: string; elapsed_ms: number }
export type ProgressListener = (event: GenerationStage) => void;

export class GenerationStreamError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function readGenerationStream<T>(response: Response, onProgress: ProgressListener): Promise<T> {
  if (!response.body) throw new GenerationStreamError(0, "The server returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      // Normalize only complete CRLF pairs, including pairs split between network chunks.
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const lines = frame.split("\n");
        const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const raw = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (event === "stage" && typeof data.stage === "string" && Number.isFinite(data.elapsed_ms) && data.elapsed_ms >= 0) onProgress(data);
        if (event === "result") return data as T;
        if (event === "error") throw new GenerationStreamError(data.status || 500, data.detail || "The request could not finish.");
      }
      if (done) throw new GenerationStreamError(0, "The connection ended before the result arrived. Check the conversation or saved drafts before retrying.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
