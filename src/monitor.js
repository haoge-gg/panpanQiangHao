import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "config.json");
const statePath = path.join(root, "data", "seen.json");
const once = process.argv.includes("--once");

function loadConfig() {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function loadSeen() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { prices: {}, firstRunDone: false };
  }
}

function saveSeen(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function buildListUrl(cfg) {
  return `https://www.pzds.com/goodsList/${cfg.gameId}/${cfg.goodsCatalogueId}?goodsCatalogueId=${cfg.goodsCatalogueId}`;
}

function normalizeGoods(item) {
  const id = String(item.goodsNo ?? item.id ?? "");
  return {
    id,
    title: item.title ?? "",
    subtitle: item.subtitle ?? "",
    simpleMessage: item.simpleMessage ?? "",
    price: Number(item.price),
    originalPrice: item.originalPrice != null ? Number(item.originalPrice) : null,
    onStandTime: item.onStandTime ?? item.createTime ?? "",
    labels: item.sellingPointLabels ?? [],
    url: id ? `https://www.pzds.com/goodsDetails/${id}/${item.goodsCatalogueId ?? 6}` : "",
  };
}

function passFilters(g, cfg) {
  if (cfg.accountType) {
    const needle = String(cfg.accountType).toLowerCase();
    const hay = `${g.simpleMessage} ${g.title} ${g.subtitle}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (cfg.keywords?.length) {
    const hay = `${g.title} ${g.subtitle} ${(g.labels || []).join(" ")}`.toLowerCase();
    const ok = cfg.keywords.some((k) => hay.includes(String(k).toLowerCase()));
    if (!ok) return false;
  }
  if (cfg.maxPrice != null && cfg.maxPrice !== "") {
    if (!Number.isFinite(g.price) || g.price > Number(cfg.maxPrice)) return false;
  }
  if (cfg.minPrice != null && cfg.minPrice !== "") {
    if (!Number.isFinite(g.price) || g.price < Number(cfg.minPrice)) return false;
  }
  return true;
}

function formatGoods(g) {
  const price = Number.isFinite(g.price) ? `¥${g.price}` : "价格未知";
  const type = g.simpleMessage ? ` | ${g.simpleMessage}` : "";
  return `[${g.id}] ${price}${type}\n  ${g.title}\n  ${g.url}`;
}

async function fetchGoodsList(cfg) {
  const browser = await chromium.launch({
    headless: cfg.headless !== false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "zh-CN",
    viewport: { width: 1440, height: 900 },
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

    // 等 Nuxt SSR 水合出 goodsList
    await page.waitForFunction(
      () => (window.__NUXT__?.data?.[0]?.goodsList?.length ?? 0) > 0,
      { timeout: 20000 }
    );

    const payload = await page.evaluate(() => {
      const pageData = window.__NUXT__?.data?.[0] || {};
      return {
        goodsList: pageData.goodsList || [],
        goodsTotalNum: pageData.goodsTotalNum,
      };
    });

    const samplePath = path.join(root, "data", "last-list.json");
    fs.mkdirSync(path.dirname(samplePath), { recursive: true });
    fs.writeFileSync(
      samplePath,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          total: payload.goodsTotalNum,
          list: payload.goodsList,
        },
        null,
        2
      ),
      "utf8"
    );

    await browser.close();
    return payload;
  } catch (err) {
    const shot = path.join(root, "data", "error.png");
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    await browser.close();
    throw err;
  }
}

function applyDiff(goods, state, cfg) {
  const alerts = [];
  for (const g of goods) {
    const prev = state.prices[g.id];
    const changed = prev == null || Number(prev) !== Number(g.price);
    if (!state.firstRunDone && cfg.notifyOnFirstRun) {
      alerts.push({ type: "list", goods: g });
    } else if (state.firstRunDone && changed) {
      alerts.push({
        type: prev == null ? "new" : "price",
        goods: g,
        prevPrice: prev,
      });
    }
    state.prices[g.id] = g.price;
  }
  return alerts;
}

async function runOnce(cfg, state) {
  console.log(
    `[${new Date().toLocaleString()}] 监控 gameId=${cfg.gameId} catalogue=${cfg.goodsCatalogueId}` +
      (cfg.accountType ? ` accountType=${cfg.accountType}` : "") +
      (cfg.maxPrice != null ? ` maxPrice=${cfg.maxPrice}` : "")
  );

  const { goodsList, goodsTotalNum } = await fetchGoodsList(cfg);
  const all = goodsList.map(normalizeGoods).filter((g) => g.id);
  const list = all.filter((g) => passFilters(g, cfg));

  console.log(
    `SSR 拉取 ${all.length} 条` +
      (goodsTotalNum != null ? `（站点 total 字段=${goodsTotalNum}）` : "") +
      `，筛选后 ${list.length} 条`
  );

  if (!all.length) {
    console.log("未拿到商品，请查看 data/error.png");
    return state;
  }

  const sorted = [...list].sort((a, b) => a.price - b.price);
  console.log("--- 价格低→高 ---");
  for (const g of sorted) {
    console.log(formatGoods(g));
  }

  const alerts = applyDiff(list, state, cfg);
  if (!state.firstRunDone) {
    state.firstRunDone = true;
    console.log(`首轮完成，已记录 ${list.length} 条价格到 data/seen.json`);
  } else if (alerts.length) {
    console.log("--- 变化提醒 ---");
    for (const a of alerts) {
      if (a.type === "new") console.log(`[上新]\n${formatGoods(a.goods)}`);
      if (a.type === "price") {
        console.log(`[改价 ${a.prevPrice}→${a.goods.price}]\n${formatGoods(a.goods)}`);
      }
    }
  } else {
    console.log("无新上架/改价。");
  }

  saveSeen(state);
  return state;
}

async function main() {
  const cfg = loadConfig();
  let state = loadSeen();

  if (once) {
    await runOnce(cfg, state);
    return;
  }

  console.log(`开始轮询，间隔 ${cfg.pollIntervalSec}s。Ctrl+C 结束。`);
  for (;;) {
    try {
      state = await runOnce(cfg, state);
    } catch (err) {
      console.error("本轮失败:", err.message || err);
    }
    await new Promise((r) =>
      setTimeout(r, Math.max(10, Number(cfg.pollIntervalSec) || 60) * 1000)
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
