// Vite config: React plugin, the agent API (server/), and a dev server reachable on the local
// network for phone/tablet demos. GROQ_API_KEY is read from .env here, server-side only.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { agentServer } from "./server/plugin";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), agentServer(env.GROQ_API_KEY || undefined)],
    server: { host: true, port: 5180 },
  };
});
