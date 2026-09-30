import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { inBrowser } from "vitepress";
import { setupDiagramZoom } from "./diagram-zoom";
import "./diagram-zoom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    if (inBrowser) {
      setupDiagramZoom(router);
    }
  },
} satisfies Theme;
