import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react";
          }
          if (
            id.includes("node_modules/exceljs") ||
            id.includes("src/lib/dataWorkbook") ||
            id.includes("src/lib/directWorkbook") ||
            id.includes("src/lib/workbookLoader")
          ) {
            return "workbook";
          }
        }
      }
    }
  }
});
