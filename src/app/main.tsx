import {
  StrictMode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router";
import {
  BookOpenText,
  Coffee,
  ChartNoAxesCombined,
  CircleUserRound,
  Settings2,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import { DirectionProvider } from "../components/ui/direction";
import { Button } from "../components/ui/primitives";
import { CalioDatabase } from "../db/database";
import { dateInTimeZone, type Locale } from "../domain/dates";
import { appState, choose, type AppState } from "./state";
import { Brand } from "./onboarding";
import Onboarding from "./onboarding";
import "../styles/calio.css";

const Journal = lazy(() => import("./journal"));
const Drinks = lazy(() => import("./drinks"));
const Insights = lazy(() => import("./insights"));
const Profile = lazy(() => import("./profile"));
const Supplements = lazy(() => import("./supplements"));
const Settings = lazy(() => import("./settings"));

const db = new CalioDatabase("real");

type Notice = {
  id: number;
  fa: string;
  en: string;
  severity: "success" | "info" | "warning" | "error";
};

function initialLocale(): Locale | null {
  try {
    const value = localStorage.getItem("calio-language");
    if (value === "fa" || value === "en") return value;
  } catch {
    // Browser privacy mode can disable localStorage.
  }
  return null;
}

function initialTheme(): "system" | "light" | "dark" {
  try {
    const theme = localStorage.getItem("calio-theme");
    if (theme === "light" || theme === "dark") return theme;
  } catch {
    // The IndexedDB preference can still be loaded below.
  }
  return "system";
}

function Application() {
  const [preferred, setPreferred] = useState<Locale | null>(initialLocale);
  const [startupTheme] = useState(initialTheme);
  const nextNotice = useRef(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const settings = useLiveQuery(() => db.settings.get("settings"), [], null);
  const profile = useLiveQuery(() => db.profile.get("profile"), [], null);
  const locale = settings?.locale ?? preferred ?? "fa";
  const theme = settings?.theme ?? startupTheme;
  const reduceMotion = settings?.reduceMotion ?? false;
  const t = choose(locale);
  const dir = locale === "fa" ? "rtl" : "ltr";
  const notify = useCallback<AppState["notify"]>(
    (fa, en, severity = "info") => {
      setNotice({ id: ++nextNotice.current, fa, en, severity });
    },
    [],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);
  useEffect(() => {
    void db.open().catch(() => setStorageError(true));
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dir;
    root.dataset.motion = reduceMotion ? "reduce" : "system";
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      window.calioApplyTheme(dark ? "dark" : "light");
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("calio-theme", theme);
      if (settings?.locale ?? preferred)
        localStorage.setItem("calio-language", locale);
      else localStorage.removeItem("calio-language");
    } catch {
      // Preferences still persist in IndexedDB after onboarding.
    }
    return () => media.removeEventListener("change", apply);
  }, [dir, locale, preferred, reduceMotion, settings?.locale, theme]);

  useEffect(() => {
    const refreshClock = () => setClock(new Date());
    window.addEventListener("focus", refreshClock);
    document.addEventListener("visibilitychange", refreshClock);
    const timer = window.setInterval(refreshClock, 60_000);
    return () => {
      window.removeEventListener("focus", refreshClock);
      document.removeEventListener("visibilitychange", refreshClock);
      window.clearInterval(timer);
    };
  }, []);

  const profileId = profile?.id;
  const consent = settings?.aiConsentAt;
  const selectedLanguage = settings?.locale;
  useEffect(() => {
    if (!profileId || !selectedLanguage || !consent) return;
    let pending: Promise<void> | undefined;
    const foreground = () => {
      if (document.visibilityState !== "visible" || pending) return;
      setClock(new Date());
      pending = import("./processing")
        .then(({ runOnForeground }) => runOnForeground(db))
        .then((results) => {
          if (results.some(({ state }) => state === "awaiting_health")) {
            notify(
              "برای تحلیل هفتگی، Apple Health را همگام کنید.",
              "Sync Apple Health to continue weekly analysis.",
              "warning",
            );
          }
        })
        .catch(() =>
          notify(
            "پردازش هفتگی کامل نشد.",
            "Weekly processing did not finish.",
            "error",
          ),
        )
        .finally(() => {
          pending = undefined;
        });
    };
    foreground();
    window.addEventListener("online", foreground);
    window.addEventListener("calio-health-synced", foreground);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      window.removeEventListener("online", foreground);
      window.removeEventListener("calio-health-synced", foreground);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [consent, notify, profileId, selectedLanguage]);

  const update = useRegisterSW();
  const updateReady = update.needRefresh[0];
  const noticeView = (notice || updateReady) && (
    <div className="global-notice">
      {updateReady && (
        <div className="notice" role="status">
          <span>{t("نسخهٔ تازه آماده است.", "An update is available.")}</span>
          <Button
            tone="quiet"
            onClick={() => void update.updateServiceWorker(true)}
          >
            {t("بارگیری نسخهٔ تازه", "Reload to update")}
          </Button>
        </div>
      )}
      {notice && (
        <Toast
          key={notice.id}
          notice={notice}
          locale={locale}
          onDismiss={dismissNotice}
        />
      )}
    </div>
  );

  if (storageError)
    return (
      <main className="onboard">
        <Brand locale={locale} />
        <p role="alert">
          {t(
            "دسترسی به ذخیره‌سازی دستگاه ممکن نیست. مجوز مرورگر را بررسی کنید.",
            "Device storage is unavailable. Check your browser settings.",
          )}
        </p>
      </main>
    );
  if (settings === null || profile === null)
    return (
      <main className="onboard">
        <Brand locale={locale} />
        <p role="status">
          {t("در حال باز کردن دفترچه…", "Opening your journal…")}
        </p>
      </main>
    );
  return (
    <DirectionProvider direction={dir}>
      {profile && settings ? (
        <appState.Provider
          value={{
            db,
            profile,
            settings,
            notify,
            today: dateInTimeZone(clock, settings.timeZone),
          }}
        >
          <Shell locale={locale} />
          {noticeView}
        </appState.Provider>
      ) : (
        <>
          <Onboarding db={db} locale={preferred} setLocale={setPreferred} />
          {noticeView}
        </>
      )}
    </DirectionProvider>
  );
}

function Toast({
  notice,
  locale,
  onDismiss,
}: {
  notice: Notice;
  locale: Locale;
  onDismiss: () => void;
}) {
  const t = choose(locale);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) {
      const timer = window.setTimeout(() => setLeaving(true), 10_000);
      return () => window.clearTimeout(timer);
    }
    const reduce =
      document.documentElement.dataset.motion === "reduce" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(onDismiss, reduce ? 0 : 160);
    return () => window.clearTimeout(timer);
  }, [leaving, onDismiss]);

  return (
    <div
      className={`notice notice--${notice.severity} toast`}
      data-leaving={leaving}
      role={notice.severity === "error" ? "alert" : "status"}
    >
      <span>{t(notice.fa, notice.en)}</span>
      <Button
        tone="quiet"
        className="icon-button"
        aria-label={t("بستن پیام", "Dismiss message")}
        onClick={() => setLeaving(true)}
      >
        <X size={15} />
      </Button>
    </div>
  );
}

const routeSections = ["", "drinks", "insights", "profile", "settings"];

function useRouteSlide(pathname: string, locale: Locale) {
  const historyIndex: number = window.history.state?.idx ?? 0;
  const previous = useRef({ pathname, historyIndex });
  const direction = useMemo(() => {
    const from = previous.current;
    if (from.pathname === pathname) return undefined;
    const fromSection = routeSections.indexOf(
      from.pathname.split("/")[1] ?? "",
    );
    const toSection = routeSections.indexOf(pathname.split("/")[1] ?? "");
    const entersChild = pathname.startsWith(from.pathname + "/");
    const leavesChild = from.pathname.startsWith(pathname + "/");
    const forward =
      fromSection !== toSection && fromSection >= 0 && toSection >= 0
        ? toSection > fromSection
        : entersChild || (!leavesChild && historyIndex >= from.historyIndex);
    return forward === (locale === "en") ? "left" : "right";
  }, [pathname, historyIndex, locale]);

  useLayoutEffect(() => {
    previous.current = { pathname, historyIndex };
  }, [pathname, historyIndex]);
  return direction;
}

function Shell({ locale }: { locale: Locale }) {
  const location = useLocation();
  const direction = useRouteSlide(location.pathname, locale);
  const t = choose(locale);
  const nav = [
    ["/", t("دفترچه", "Journal"), BookOpenText],
    ["/drinks", t("نوشیدنی", "Drinks"), Coffee],
    ["/insights", t("تحلیل", "Insights"), ChartNoAxesCombined],
    ["/profile", t("پروفایل", "Profile"), CircleUserRound],
  ] as const;
  const settingsLink = (
    <Link to="/settings" className="nav-link sidebar-settings">
      <Settings2 aria-hidden size={20} />
      {t("تنظیمات", "Settings")}
    </Link>
  );
  useEffect(() => {
    if (location.key !== "default") {
      document.getElementById("calio-main")?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [location.key]);

  return (
    <>
      <a className="button button--quiet skip-link" href="#calio-main">
        {t("رفتن به محتوا", "Skip to content")}
      </a>
      <header className="mobile-header">
        <Link to="/" aria-label={t("خانهٔ کالیو", "Calio home")}>
          <Brand locale={locale} />
        </Link>
        <Link
          to="/settings"
          className="button button--quiet icon-button"
          aria-label={t("تنظیمات", "Settings")}
        >
          <Settings2 size={19} />
        </Link>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <Link
            to="/"
            className="brand"
            aria-label={t("خانهٔ کالیو", "Calio home")}
          >
            <Brand locale={locale} />
          </Link>
          <nav
            className="main-nav"
            aria-label={t("ناوبری اصلی", "Primary navigation")}
          >
            {nav.map(([path, title, Icon]) => (
              <NavLink
                key={path}
                end={path === "/"}
                to={path}
                className="nav-link"
              >
                <Icon size={20} aria-hidden />
                {title}
              </NavLink>
            ))}
          </nav>
          {settingsLink}
        </aside>
        <main className="main" id="calio-main" tabIndex={-1}>
          <Suspense
            fallback={<p role="status">{t("در حال بارگذاری…", "Loading…")}</p>}
          >
            <div
              className="route-content"
              data-slide={direction}
              key={location.pathname}
            >
              <Routes>
                <Route path="/" element={<Journal />} />
                <Route path="/drinks" element={<Drinks />} />
                <Route path="/insights/*" element={<Insights />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/profile/supplements" element={<Supplements />} />
                <Route path="/settings/*" element={<Settings />} />
                <Route
                  path="*"
                  element={
                    <section className="panel">
                      <h1>{t("صفحه پیدا نشد", "Page not found")}</h1>
                      <Link to="/" className="button button--quiet">
                        {t("بازگشت به دفترچه", "Back to journal")}
                      </Link>
                    </section>
                  }
                />
              </Routes>
            </div>
          </Suspense>
        </main>
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("calio_root_missing");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Application />
    </BrowserRouter>
  </StrictMode>,
);
