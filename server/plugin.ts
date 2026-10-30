/**
 * Vite plugin that serves the agent API at /api/agent on the dev server (`npm run dev`)
 * and the preview server (`npm run preview`). The API key stays in Node; it is never
 * bundled into the browser code.
 */
import type { Plugin } from "vite";
import { createAgentHandler } from "./agents";

export function agentServer(apiKey?: string): Plugin {
  const handler = createAgentHandler(apiKey);
  return {
    name: "habbit-quest-agents",
    configureServer(server) {
      server.middlewares.use("/api/agent", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/agent", handler);
    },
  };
}
