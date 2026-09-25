import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "./",
  define: {
    CESIUM_BASE_URL: JSON.stringify("/cesiumStatic/node_modules/cesium/Build/Cesium/"),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: "node_modules/cesium/Build/Cesium/Workers", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/ThirdParty", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/Assets", dest: "cesiumStatic" },
        { src: "node_modules/cesium/Build/Cesium/Widgets", dest: "cesiumStatic" },
      ],
    }),
  ],
});
