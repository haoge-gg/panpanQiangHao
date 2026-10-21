import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
}

export function buildListUrl(cfg) {
  return `https://www.pzds.com/goodsList/${cfg.gameId}/${cfg.goodsCatalogueId}?goodsCatalogueId=${cfg.goodsCatalogueId}`;
}

export function normalizeGoods(item) {
  const id = String(item.goodsNo ?? item.id ?? "");
  const catalogueId = item.goodsCatalogueId ?? 6;
  return {
    id,
    title: item.title ?? "",
    subtitle: item.subtitle ?? "",
    simpleMessage: item.simpleMessage ?? "",
    price: Number(item.price),
    originalPrice:
      item.originalPrice != null ? Number(item.originalPrice) : null,
    onStandTime: item.onStandTime ?? item.createTime ?? "",
    labels: item.sellingPointLabels ?? [],
    viewsNum: item.viewsNum ?? null,
    hots: item.hots ?? null,
    bargain: !!item.bargain,
    compensation: !!item.compensation,
    url: id
      ? `https://www.pzds.com/goodsDetails/${id}/${catalogueId}`
      : "",
    img: item.goodsImgSmall || item.goodsImg || "",
  };
}

/** 本地对齐：QQ + 可二次实名 + 无封号 */
export function passThreeFilters(g, filters = {}) {
  const accountType = filters.accountType || "QQ";
  const realName = filters.realName || "可二次实名";
  const accountStatus = filters.accountStatus || "无封号";

  const msg = `${g.simpleMessage || ""}`;
  const sub = `${g.subtitle || ""}`;

  if (accountType && !msg.includes(accountType)) return false;

  if (realName === "可二次实名") {
    if (!sub.includes("可二次实名") || sub.includes("不可二次实名")) return false;
  } else if (realName && !sub.includes(realName)) {
    return false;
  }

  if (accountStatus === "无封号") {
    if (sub.includes("封号中")) return false;
  } else if (accountStatus && !sub.includes(accountStatus)) {
    return false;
  }

  return true;
}

/**
 * SSR 拉取 + 三项本地过滤（不点筛选，避免触发 WAF）
 */
export async function fetchFilteredGoods(cfg = loadConfig()) {
  const browser = await chromium.launch({
    headless: cfg.headless !== false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  try {
    await page.goto(buildListUrl(cfg), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => (window.__NUXT__?.data?.[0]?.goodsList?.length ?? 0) > 0,
      { timeout: 20000 }
    );

    const raw = await page.evaluate(() => {
      const pageData = window.__NUXT__?.data?.[0] || {};
      return {
        goodsList: pageData.goodsList || [],
        goodsTotalNum: pageData.goodsTotalNum,
      };
    });

    const all = raw.goodsList.map(normalizeGoods).filter((g) => g.id);
    const list = all.filter((g) => passThreeFilters(g, cfg.filters));

    const payload = {
      at: new Date().toISOString(),
      source: "ssr+local-filter",
      filters: cfg.filters,
      action: cfg.action,
      totalRaw: all.length,
      total: list.length,
      list: list.sort((a, b) => a.price - b.price),
      rawSampleSubtitles: [...new Set(all.map((g) => g.subtitle))],
    };

    const out = path.join(root, "data", "filtered-list.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");

    await browser.close();
    return payload;
  } catch (err) {
    await browser.close();
    throw err;
  }
}
