// Vite config: React plugin and a dev server reachable on the local network for phone/tablet demos.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5180, strictPort: true }, // the API and Google only allow this port
});
