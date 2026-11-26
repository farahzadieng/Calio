import { readFile, mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { Row } from "../../src/db/records";
import type { HealthDay } from "../../src/domain/health";
import type { Nutrients } from "../../src/domain/nutrition";

const healthText = await readFile(
  new URL("../../fixtures/health-valid.txt", import.meta.url),
  "utf8",
);
const word = (locale: "fa" | "en") => (fa: string, en: string) =>
  locale === "fa" ? fa : en;

async function onboard(page: Page, locale: "fa" | "en") {
  const t = word(locale);
  await page.goto("/");
  await page
    .getByRole("button", { name: t("فارسی", "English"), exact: true })
    .click();
  await page
    .getByLabel(t("نام", "First name"), { exact: true })
    .fill(t("آزمایشی", "Synthetic"));
  await page.getByLabel(t("سن", "Age"), { exact: true }).fill(t("۳۰", "30"));
  await page
    .getByLabel(t("قد (سانتی‌متر)", "Height (cm)"), { exact: true })
    .fill(t("۱۷۰", "170"));
  await page
    .getByLabel(t("وزن (کیلوگرم)", "Weight (kg)"), { exact: true })
    .fill(t("۷۰", "70"));
  await page
    .getByRole("button", { name: t("ادامه", "Continue"), exact: true })
    .click();
  await page
    .getByRole("heading", { name: t("هدف و فعالیت", "Goals and activity") })
    .waitFor();
  await page
    .getByRole("button", { name: t("ادامه", "Continue"), exact: true })
    .click();
  await page
    .getByRole("button", { name: t("ورود به دفترچه", "Open journal") })
    .click();
  await expect(
    page.getByRole("heading", { name: t("دفترچهٔ غذا", "Food journal") }),
  ).toBeVisible();
}

test("Persian journal drafts, save, PWA offline reload, edit and delete", async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page, "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  const textarea = page.getByLabel("غذا، نوشیدنی و حال‌وهوای امروز");
  await textarea.fill("یادداشت ساختگی ۲ لیوان چای");
  await page.getByRole("link", { name: "نوشیدنی", exact: true }).click();
  await page
    .getByRole("heading", { name: "نوشیدنی‌ها", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "دفترچه", exact: true }).click();
  await expect(textarea).toHaveValue("یادداشت ساختگی ۲ لیوان چای");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(textarea).toHaveValue("یادداشت ساختگی ۲ لیوان چای");
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByText("یادداشت آفلاین ذخیره شد.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("یادداشت ساختگی ۲ لیوان چای")).toBeVisible();
  await expect(
    await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some(
        (font) =>
          font.family.replaceAll('"', "") === "Bonyade Koodak" &&
          font.status === "loaded",
      );
    }),
  ).toBe(true);
  if (info.project.name === "chromium") {
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/journal-fa-light.png",
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "ویرایش یادداشت" }).click();
  await textarea.fill("ویرایش ساختگی");
  await page.getByRole("link", { name: "نوشیدنی", exact: true }).click();
  await page.getByRole("link", { name: "دفترچه", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "ویرایش یادداشت" }),
  ).toBeVisible();
  await expect(textarea).toHaveValue("ویرایش ساختگی");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByText("ویرایش ساختگی")).toBeVisible();
  await page.getByRole("button", { name: "حذف یادداشت" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "حذف", exact: true })
    .click();
  await expect(page.getByText("ویرایش ساختگی")).toHaveCount(0);
  await context.setOffline(false);
});

test("English settings, both calendars, dark mode, reduced motion and accessibility", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 870 });
  await onboard(page, "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest-dark.webmanifest",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/assets/brand/icon-dark-192.png",
  );
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("switch", { name: "Reduce motion" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await page.getByLabel("Display calendar").click();
  await page.getByRole("option", { name: "Solar Hijri", exact: true }).click();
  await page.getByRole("link", { name: "Journal", exact: true }).click();
  const picker = page.getByRole("button", { name: /^Choose date/ });
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const width of [320, 375, 430, 1280]) {
    await page.setViewportSize({ width, height: 870 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
  }
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  if (info.project.name === "chromium") {
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/journal-en-dark.png",
      fullPage: true,
    });
  }
});

test("synthetic Health paste, drinks, supplements, full backup and diagnostics", async ({
  page,
}, info) => {
  await onboard(page, "en");
  const channel = page.getByRole("navigation", { name: "Primary navigation" });
  await channel.getByRole("link", { name: "Drinks" }).click();
  const glass = page.getByRole("button", { name: /Add a glass of water/ });
  await glass.dblclick();
  await expect(
    page.getByRole("status").filter({ hasText: "500 mL" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Water", exact: true }),
  ).toHaveCount(2);
  for (const [action, title, amount] of [
    ["Add a cup of coffee", "Coffee", "150"],
    ["Add a cup of tea", "Tea", "200"],
    ["Add a glass of alcohol-free beer", "Alcohol-free beer", "250"],
  ] as const) {
    const quickDrink = page.getByRole("button", { name: new RegExp(action) });
    await expect(quickDrink.locator("img")).toBeVisible();
    await expect
      .poll(() =>
        quickDrink
          .locator("img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await quickDrink.click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: title, exact: true }).locator(".."),
    ).toContainText(`${amount} mL`);
  }
  await expect(
    page.getByRole("status").filter({ hasText: "1,100 mL logged" }),
  ).toBeVisible();
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "docs/screenshots/drinks-quick-water.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole("button", { name: "Log another drink" }).click();
  const drinkDialog = page.getByRole("dialog", { name: "Log a drink" });
  await drinkDialog.getByLabel("Volume (mL)").fill("200");
  await drinkDialog.getByRole("button", { name: "Save drink" }).click();
  await expect(
    page.getByRole("heading", { name: "Coffee", exact: true }),
  ).toHaveCount(2);
  await channel.getByRole("link", { name: "Profile" }).click();
  await page.getByRole("link", { name: "Supplements" }).click();
  await page
    .getByRole("button", { name: "Add supplement", exact: true })
    .click();
  await page.getByLabel("Product name").fill("Synthetic label");
  await page.getByLabel("Label serving unit").fill("tablet");
  await page.getByLabel("Label amount").fill("10");
  await page.getByRole("button", { name: "Add to composition" }).click();
  await page
    .getByRole("button", { name: "Save supplement", exact: true })
    .click();
  await page.getByLabel("Number of label servings").fill("1");
  await page.getByRole("button", { name: "Save serving" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic label", exact: true }),
  ).toBeVisible();
  await page.goto("/settings/integrations");
  await expect(
    page.getByRole("link", { name: "Run Shortcut" }),
  ).toHaveAttribute("href", "shortcuts://run-shortcut?name=HealthKit-Bridge");
  await page.getByLabel("Health export text").fill(healthText);
  await page.getByRole("button", { name: "Import data" }).click();
  await expect(page.getByText("3 dates checked.")).toBeVisible();
  await page.goto("/settings/backup");
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const path = await (await pendingDownload).path();
  await page.locator("input[type=file]").setInputFiles({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: await readFile(path),
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm merge" })
    .click();
  await expect(page.getByText("Restore completed.")).toBeVisible();
  await page.goto("/settings/diagnostics");
  for (const button of [
    "Test synthetic AI pipeline",
    "Test Health sample",
    "Test weekly report",
    "Test monthly consultation",
    "Test backup round-trip",
    "Test offline and retry",
  ]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByText("TEST · passed")).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Test live connection", exact: true })
    .click();
  await expect(page.getByText("TEST · blocked by prerequisites")).toBeVisible();
  await page.goto("/settings/library");
  await expect(page.getByText("No matching foods.")).toBeVisible();
});

test("insight routes, mobile calendar, source gaps and the local monthly preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await onboard(page, "en");
  await page.getByRole("button", { name: /^Choose date/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose date" });
  await expect(dialog.getByRole("grid")).toBeVisible();
  const calendarButtons = await dialog
    .getByRole("grid")
    .getByRole("button")
    .all();
  expect(calendarButtons.length).toBeGreaterThan(20);
  const size = await calendarButtons[0]?.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeGreaterThanOrEqual(44);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(320);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.getByRole("button", { name: "Show all 39 nutrients" }).click();
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(40);
  await page.getByRole("link", { name: "Weekly", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Weekly insights" }),
  ).toBeVisible();
  await expect(
    page.getByText("No report is saved for this period yet."),
  ).toBeVisible();
  await page.getByRole("link", { name: "Monthly", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Monthly weight comparison" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview consultation prompt" })
    .click();
  await expect(page.getByLabel("Prompt to copy")).toHaveValue(
    /paired_day_coverage/,
  );
  await expect(page.getByLabel("Prompt to copy")).not.toHaveValue(/Synthetic/);
  const manifest = await page.request
    .get("/manifest.webmanifest")
    .then((response) => response.json());
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "192x192",
    "512x512",
  ]);
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) => (await caches.open(key)).keys()),
      )
    )
      .flat()
      .map((request) => new URL(request.url).pathname);
  });
  expect(cached.some((path) => path.endsWith(".woff2"))).toBe(true);
  expect(cached.some((path) => path.startsWith("/api/"))).toBe(false);
});

test("Persian calorie table and copied ChatGPT JSON work without a live API", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page, "fa");
  await page.goto("/settings/library");
  await page.getByRole("link", { name: "مرجع و تحلیل کالری" }).click();
  await expect(
    page.getByRole("heading", { name: "جدول مرجع خوراکی‌های ایرانی" }),
  ).toBeVisible();
  await page.getByLabel("جست‌وجو در جدول مرجع").fill("سنگک");
  await expect(page.getByRole("row", { name: /سنگک.*۲۵۸/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /بربری/ })).toHaveCount(0);
  await page.getByLabel("نام فارسی خوراکی").fill("سنگک");
  await page
    .getByRole("button", { name: "کپی به پرامپت", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "کالری از مرجع محلی خوانده شد." }),
  ).toBeVisible();
  await page.getByLabel("نام فارسی خوراکی").fill("خوراک ساختگی");
  await page
    .getByRole("button", { name: "کپی به پرامپت", exact: true })
    .click();
  await expect(page.getByLabel("پرامپت قابل کپی")).toHaveValue(/خوراک ساختگی/);
  const paste = page.getByLabel("پاسخ JSON از ChatGPT");
  await paste.fill("{}");
  await page.getByRole("button", { name: "بررسی پاسخ" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "JSON پاسخ معتبر نیست" }),
  ).toBeVisible();
  await paste.fill(
    JSON.stringify({
      food: {
        nameFa: "خوراک ساختگی",
        nameEn: "",
        variant: "",
        preparation: "",
        brand: null,
        basis: "per_100g",
      },
      result: {
        status: "known",
        kcalPer100: 123,
        basis: "per_100g",
        source: {
          url: "https://nutrition.example/synthetic",
          title: "Synthetic reference",
        },
      },
    }),
  );
  await page.getByRole("button", { name: "بررسی پاسخ" }).click();
  await expect(
    page.getByRole("link", { name: "Synthetic reference" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ذخیرهٔ کالری" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "کالری در کتابخانه ذخیره شد." }),
  ).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "مرجع و تحلیل کالری" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole("link", { name: "کتابخانهٔ خوراکی‌ها" }).click();
  await expect(
    page.getByRole("heading", { name: "خوراک ساختگی" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test.describe("synthetic AI-enabled browser", () => {
  test.use({ serviceWorkers: "block" });

  test("English automatic calorie lookup uses a synthetic same-origin gateway", async ({
    page,
  }) => {
    await onboard(page, "en");
    await page.route("**/api/calio/ai/settings", (route) =>
      route.fulfill({
        json: {
          baseUrl: "https://provider.example/v1",
          model: "synthetic/analysis",
          calorieModel: "synthetic/search",
          hasKey: true,
          enabled: true,
          revision: "synthetic-revision",
        },
      }),
    );
    const requests: unknown[] = [];
    await page.route("**/api/calio/ai", async (route) => {
      const payload = route.request().postDataJSON();
      requests.push(payload);
      const source = {
        url: "https://nutrition.example/synthetic",
        title: "Synthetic reference",
      };
      await route.fulfill({
        json: {
          requestId: payload.requestId,
          model: "synthetic/search",
          provider: "provider.example",
          output: {
            status: "known",
            kcalPer100: 123,
            basis: "per_100g",
            source,
          },
          evidence: [
            {
              id: "sonar-1",
              ...source,
              accessedDate: "2026-11-26",
              basis: "per_100g",
              supportedNutrients: ["energy_kcal"],
              supportsPortion: false,
              supportsAddedSugar: false,
              supportsRecipeYield: false,
            },
          ],
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      });
    });
    await page.goto("/settings/integrations");
    const consent = page.getByRole("switch", {
      name: "Consent to AI processing",
    });
    await consent.click();
    await expect(consent).toHaveAttribute("aria-checked", "true");
    await page.goto("/settings/library/calories");
    await page.getByLabel("English food name").fill("Synthetic dish");
    await page.getByLabel("Calorie lookup method").click();
    await page.getByRole("option", { name: "Automatic API lookup" }).click();
    const action = page.getByRole("button", {
      name: "Automatic API lookup",
      exact: true,
    });
    await action.click();
    await expect(
      page.getByRole("link", { name: "Synthetic reference" }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      operation: "calories",
      input: {
        nameFa: "",
        nameEn: "Synthetic dish",
        variant: "",
        preparation: "",
        brand: null,
        basis: "per_100g",
      },
    });
    await action.click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Calories loaded from the local reference." }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
  });
});

test("Persian date shortcuts use Eastern numerals and notifications dismiss after ten seconds", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2026-11-26T12:00:00Z") });
  await onboard(page, "fa");
  const heading = page.getByRole("heading", { name: "دفترچهٔ غذا" });
  await expect(heading).toHaveCSS("font-weight", "470");
  await expect(page.locator("body")).toHaveCSS("font-weight", "330");
  expect(
    await page.evaluate(async () => {
      const [one, two] = await Promise.all([
        document.fonts.load('470 24px "Bonyade Koodak"', "۱"),
        document.fonts.load('470 24px "Bonyade Koodak"', "۲"),
      ]);
      return [one.length, two.length];
    }),
  ).toEqual([1, 1]);
  const date = page.getByRole("button", { name: /^انتخاب تاریخ/ });
  await expect(date).toContainText("۱۴۰۵");
  expect(await date.textContent()).not.toMatch(/[0-9]/);
  await date.click();
  const dialog = page.getByRole("dialog", { name: "انتخاب تاریخ" });
  await expect(
    dialog.getByRole("button", { name: "امروز", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "دیروز", exact: true }).click();
  await expect(date).toContainText("۴ آذر");
  await date.click();
  await dialog.getByRole("button", { name: "امروز", exact: true }).click();
  await expect(date).toContainText("۵ آذر");
  if (info.project.name === "chromium") {
    await mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({
      path: "docs/screenshots/journal-fa-japandi.png",
      fullPage: true,
    });
  }
  await page
    .getByLabel("غذا، نوشیدنی و حال‌وهوای امروز")
    .fill("یادداشت ساختگی");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  const toast = page.locator(".toast");
  await expect(toast).toHaveAttribute("data-leaving", "false");
  await page.clock.fastForward(9600);
  await expect(toast).toBeVisible();
  await page.clock.fastForward(650);
  await expect(toast).toHaveCount(0);
});

test.describe("intercepted connection settings", () => {
  test.use({ serviceWorkers: "block" });
  test("connection settings prefill editable model IDs and never repopulate the key", async ({
    page,
  }) => {
    await onboard(page, "en");
    let config = {
      baseUrl: "https://iranrouter.net/api/v1",
      model: "openai/gpt-6-luna",
      calorieModel: "perplexity/sonar",
      hasKey: false,
      enabled: false,
      revision: "synthetic-revision",
    };
    const updates: {
      baseUrl: string;
      model: string;
      calorieModel: string;
      apiKey?: string;
    }[] = [];
    await page.route("**/api/calio/ai/settings", async (route) => {
      if (route.request().method() === "PUT") {
        const input = route.request().postDataJSON();
        updates.push(input);
        config = {
          ...config,
          baseUrl: input.baseUrl,
          model: input.model,
          calorieModel: input.calorieModel,
          hasKey: true,
          enabled: true,
        };
      }
      await route.fulfill({ json: config });
    });
    await page.goto("/settings/integrations");
    const analysis = page.getByLabel("Analysis and reporting model");
    const search = page.getByLabel("Calorie search model");
    const key = page.getByLabel("API key");
    const save = page.getByRole("button", { name: "Save connection" });
    await expect(analysis).toHaveValue("openai/gpt-6-luna");
    await expect(search).toHaveValue("perplexity/sonar");
    await expect(save).toHaveCSS("min-height", "44px");
    await expect(analysis).toHaveCSS("border-top-width", "1px");
    await page.keyboard.press("Tab");
    await analysis.focus();
    await expect(analysis).toHaveCSS("outline-width", "2px");
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await page.getByLabel("API base URL").fill("https://provider.example/v1");
    await analysis.fill("synthetic/analysis");
    await search.fill("synthetic/search");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("Enter an API key");
    expect(updates).toHaveLength(0);
    await key.fill("synthetic-ui-test-key");
    await save.click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "Connection settings saved." }),
    ).toBeVisible();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      baseUrl: "https://provider.example/v1",
      model: "synthetic/analysis",
      calorieModel: "synthetic/search",
      apiKey: "synthetic-ui-test-key",
    });
    await expect(key).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Test analysis model" }),
    ).toBeDisabled();
  });
});

test("insight charts compare recorded energy, preserve gaps and offer exact values in every period", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page, "en");
  const stamp = "2026-11-26T12:00:00.000Z";
  const dates = ["2026-11-23", "2026-11-24", "2026-11-25"] as const;
  const note = (
    date: string,
    status: "pending" | "processed",
  ): Row<"journal_entries"> => ({
    id: crypto.randomUUID(),
    text: "Synthetic chart fixture",
    localDate: date,
    status,
    revision: 1,
    time: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const notes = [
    note(dates[0], "processed"),
    note(dates[1], "processed"),
    note(dates[1], "pending"),
  ];
  const completed = notes.slice(0, 2);
  const parsed = completed.map(({ id, localDate }): Row<"parsed_entries"> => ({
    entryId: id,
    localDate,
    revision: 1,
    promptVersion: "synthetic",
    model: "synthetic",
    output: {},
    symptoms: [],
    unparsedText: [],
    createdAt: stamp,
  }));
  const schema: { required: string[] } = JSON.parse(
    await readFile(
      new URL("../../schemas/nutrients.schema.json", import.meta.url),
      "utf8",
    ),
  );
  const unknown = Object.fromEntries(
    schema.required.map((key) => [key, null]),
  ) as Nutrients;
  const meals = completed.map(
    ({ id, localDate }, index): Row<"meal_items"> => ({
      entryId: id,
      itemId: "synthetic-meal",
      localDate,
      revision: 1,
      nameFa: "",
      nameEn: "Synthetic dish",
      originalQuantity: 100,
      originalUnit: "g",
      grams: 100,
      ml: null,
      foodId: null,
      portionId: null,
      foodSnapshot: null,
      portionSnapshot: null,
      nutrients: {
        ...unknown,
        energy_kcal: index === 0 ? 1200 : 400,
        protein_g: 30,
      },
      addedSugarG: null,
      excludedFromTotals: false,
      confidence: "medium",
      assumptions: [],
      reviewReason: null,
      status: "calculated",
    }),
  );
  const importId = crypto.randomUUID();
  const observation = (value: number | null): HealthDay["restingKcal"] => ({
    value,
    status: value === null ? "missing" : "valid",
    importedAt: stamp,
    importId,
  });
  const health: HealthDay[] = [
    {
      date: dates[0],
      restingKcal: observation(1500),
      activeKcal: observation(300),
      steps: observation(4500),
      distanceKm: observation(3),
    },
    {
      date: dates[2],
      restingKcal: observation(null),
      activeKcal: observation(null),
      steps: observation(0),
      distanceKm: observation(0),
    },
  ];
  // Browser contexts have their own empty Calio database. Only this synthetic fixture is written.
  await page.evaluate<void, Record<string, unknown[]>>(
    (fixture) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("calio-real");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(Object.keys(fixture), "readwrite");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          for (const [table, rows] of Object.entries(fixture)) {
            const store = tx.objectStore(table);
            rows.forEach((row) => store.put(row));
          }
        };
      }),
    {
      journal_entries: notes,
      parsed_entries: parsed,
      meal_items: meals,
      health_daily: health,
    },
  );

  await page.goto("/insights/day/2026-11-23");
  const energy = page.getByRole("region", {
    name: "Energy intake and expenditure",
  });
  await expect(
    energy.locator(".chart-readout").getByText("1,200", { exact: true }),
  ).toBeVisible();
  await expect(
    energy.locator(".chart-readout").getByText("1,800", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("-600", { exact: true })).toBeVisible();

  await page.goto("/insights/week/2026-11-23");
  await expect(
    energy.locator(".chart-readout").getByText("400", { exact: true }),
  ).toBeVisible();
  await expect(
    energy
      .getByText("Known subtotal · partial intake")
      .filter({ visible: true }),
  ).toHaveCount(2);
  await energy.getByText("Chart data table", { exact: true }).click();
  const table = energy.getByRole("table", { name: "Chart data" });
  await expect(
    table.getByRole("row", { name: /November 23.*1,200.*1,800/ }),
  ).toBeVisible();
  await expect(
    table.getByRole("row", { name: /November 25.*No data.*No data/ }),
  ).toBeVisible();
  await energy.getByText("Chart data table", { exact: true }).click();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBe(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  if (info.project.name === "chromium") {
    await mkdir("docs/screenshots", { recursive: true });
    await page.setViewportSize({ width: 390, height: 1100 });
    await energy.screenshot({ path: "docs/screenshots/insights-energy.png" });
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await page.getByLabel("Chart metric").click();
  await page.getByRole("option", { name: "Steps" }).click();
  const steps = page.getByRole("region", { name: "Steps", exact: true });
  await expect(steps.locator('[data-availability="zero"]')).toHaveCount(1);
  await expect(
    steps.locator(".chart-readout").getByText("0", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Chart metric").click();
  await page.getByRole("option", { name: "Macronutrients" }).click();
  await expect(
    page
      .getByRole("region", { name: "Macronutrients" })
      .locator(".chart-readout")
      .getByText("30", { exact: true }),
  ).toBeVisible();
  await page.goto("/insights/month/2026-11-01");
  await expect(
    energy.locator(".chart-readout").getByText("400", { exact: true }),
  ).toBeVisible();
  await energy.getByLabel("Chart date").click();
  await page
    .getByRole("option", { name: "November 23, 2026", exact: true })
    .click();
  await expect(
    energy.locator(".chart-readout").getByText("1,800", { exact: true }),
  ).toBeVisible();

  await page.goto("/settings");
  await page.getByLabel("Language").click();
  await page.getByRole("option", { name: "فارسی", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("تقویم نمایشی").click();
  await page.getByRole("option", { name: "شمسی", exact: true }).click();
  await page.getByRole("button", { name: "شب", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/insights/day/2026-11-23");
  const persian = page.getByRole("region", { name: "دریافت و مصرف انرژی" });
  await expect(persian.locator(".chart-readout")).toContainText("۱٬۸۰۰");
  await expect(persian.locator(".insight-plot")).toHaveAttribute("dir", "ltr");
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 390, height: 1100 });
    await persian.screenshot({
      path: "docs/screenshots/insights-energy-fa-dark.png",
    });
  }
});

test("journal creates a compound supplement and logs repeat servings offline", async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page, "en");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const composer = page.locator(".journal-composer");
  expect(
    await composer.evaluate(
      (form) => getComputedStyle(form, "::before").backgroundImage,
    ),
  ).toContain("journal-paper");
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Log supplement", exact: true })
    .click();
  const product = page.getByRole("dialog", {
    name: "Create and log a supplement",
  });
  await product.getByLabel("Product name").fill("Synthetic compound");
  await product.getByLabel("Label serving unit").fill("tablet");
  await product.getByLabel("Number of label servings").fill("2");
  await product.getByLabel("Nutrient").click();
  await page
    .getByRole("option", { name: "Other ingredient, such as B complex" })
    .click();
  await product.getByLabel("Ingredient name on label").fill("B complex blend");
  await product.getByLabel("Label amount").fill("10");
  await product.getByRole("button", { name: "Add to composition" }).click();
  await product.getByLabel("Nutrient").click();
  await page.getByRole("option", { name: "Vitamin C", exact: true }).click();
  await product.getByLabel("Unit", { exact: true }).click();
  await page.getByRole("option", { name: "g", exact: true }).click();
  await product.getByLabel("Label amount").fill("0.2");
  await product.getByRole("button", { name: "Save and log serving" }).click();
  await expect(product).toHaveCount(0);
  const journalLog = page
    .getByRole("heading", { name: "Synthetic compound" })
    .locator("..");
  await expect(journalLog).toContainText("2 tablet");
  await expect(journalLog).toContainText("B complex blend 20 mg");
  await expect(journalLog).toContainText("Vitamin C 0.4 g");
  await page.reload();
  await expect(journalLog).toContainText("Vitamin C 0.4 g");
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 390, height: 1050 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.screenshot({
      path: "docs/screenshots/journal-supplements.png",
      animations: "disabled",
    });
  }
  await page
    .getByRole("button", { name: "Log supplement", exact: true })
    .click();
  const serving = page.getByRole("dialog", {
    name: "Log a supplement serving",
  });
  await expect(
    serving.getByRole("combobox", { name: "Supplement" }),
  ).toContainText("Synthetic compound");
  await serving.getByLabel("Number of label servings").fill("0.5");
  await serving.getByRole("button", { name: "Save serving" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic compound" }),
  ).toHaveCount(2);
  await context.setOffline(false);
  await page.getByRole("link", { name: "Insights", exact: true }).click();
  await page.getByRole("button", { name: "Show all 39 nutrients" }).click();
  await expect(page.getByRole("row", { name: /Vitamin C/ })).toContainText(
    "500",
  );
});

test("route slides follow navigation and locale without fading, and honor reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await onboard(page, "en");
  const scene = page.locator(".route-content");
  const primary = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(scene).not.toHaveAttribute("data-slide", /.+/);
  await primary.getByRole("link", { name: "Drinks", exact: true }).click();
  await expect(scene).toHaveAttribute("data-slide", "left");
  await expect(scene).toHaveCSS("animation-name", "route-slide");
  await expect(scene).toHaveCSS("opacity", "1");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(390);
  await page.goBack();
  await expect(scene).toHaveAttribute("data-slide", "right");
  await page.goForward();
  await expect(scene).toHaveAttribute("data-slide", "left");

  await page.goto("/settings");
  await page.getByLabel("Language").click();
  await page.getByRole("option", { name: "فارسی", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("link", { name: "دفترچه", exact: true }).click();
  await page.getByRole("link", { name: "نوشیدنی", exact: true }).click();
  await expect(scene).toHaveAttribute("data-slide", "right");
  await expect(scene).toHaveCSS("animation-name", "route-slide");
  await expect(
    page.getByRole("button", { name: "بستن", exact: true }),
  ).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "دفترچه", exact: true }).click();
  await expect(scene).toHaveAttribute("data-slide", "left");
  await expect(scene).toHaveCSS("animation-name", "none");
});
