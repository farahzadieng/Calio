(() => {
  window.calioApplyTheme = (theme) => {
    const dark = theme === "dark";
    const icon = `/assets/brand/icon-${theme}-192.png`;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = dark
      ? "#211b16"
      : "#f5f0eb";
    document
      .querySelector('link[rel="manifest"]')
      .setAttribute(
        "href",
        dark ? "/manifest-dark.webmanifest" : "/manifest.webmanifest",
      );
    for (const rel of ["icon", "apple-touch-icon"]) {
      document.querySelector(`link[rel="${rel}"]`).setAttribute("href", icon);
    }
  };

  let preference = "system";
  let locale = "fa";
  try {
    preference = localStorage.getItem("calio-theme") || preference;
    locale = localStorage.getItem("calio-language") || locale;
  } catch {
    // The app still works when the browser has restricted localStorage.
  }
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.lang = locale === "en" ? "en" : "fa";
  root.dir = root.lang === "fa" ? "rtl" : "ltr";
  window.calioApplyTheme(dark ? "dark" : "light");
})();
