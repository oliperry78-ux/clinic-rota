import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["unsuspectedly-pseudoexperimental-gala.ngrok-free.dev"],
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
