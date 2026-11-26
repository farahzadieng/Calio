import { createContext, useContext, type ReactNode } from "react";
import type { CalioDatabase } from "../db/database";
import type { Locale } from "../domain/dates";
import type { Profile, Settings } from "../domain/profile";

export type AppState = {
  db: CalioDatabase;
  settings: Settings;
  profile: Profile;
  today: string;
  notify: (
    fa: string,
    en: string,
    severity?: "success" | "info" | "warning" | "error",
  ) => void;
};
export const appState = createContext<AppState | null>(null);

export function useCalio() {
  const value = useContext(appState);
  if (!value) throw new Error("calio_context_missing");
  const { locale } = value.settings;
  return {
    ...value,
    locale,
    t: (fa: string, en: string) => (locale === "fa" ? fa : en),
  };
}
export const choose = (locale: Locale) => (fa: string, en: string) =>
  locale === "fa" ? fa : en;

export function Page({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className ? `page ${className}` : "page"}>
      <header className="page-intro">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="subtitle">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
