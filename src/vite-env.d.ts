/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Window {
  calioApplyTheme: (theme: "light" | "dark") => void;
}
