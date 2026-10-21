import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
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
const hits = [];

page.on("request", (req) => {
  const u = req.url();
  if (/goodsPublic\/page|goods\/page|goodsList|goodsPublic/i.test(u)) {
    hits.push({
      phase: "req",
      method: req.method(),
      url: u,
      postData: req.postData()?.slice(0, 500),
    });
    console.log("REQ", req.method(), u.slice(0, 180));
  }
});

page.on("response", async (res) => {
  const u = res.url();
  if (/goodsPublic\/page|goods\/page/i.test(u)) {
    const text = await res.text().catch(() => "");
    hits.push({
      phase: "res",
      status: res.status(),
      url: u,
      body: text.slice(0, 800),
    });
    console.log("RES", res.status(), u.slice(0, 180), text.slice(0, 120));
  }
});

const url = "https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6";
console.log("goto", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

// 等 WASM / 前端脚本就绪
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const n = await page.locator("text=/¥|￥/").count().catch(() => 0);
  const loading = await page.locator("text=加载").count().catch(() => 0);
  console.log(`t=${i + 1}s priceNodes=${n} loading=${loading} hits=${hits.length}`);
  if (hits.some((h) => h.phase === "res")) break;
}

// 尝试点「全部」账号类型，触发刷新
const qq = page.getByText("QQ", { exact: true }).first();
if (await qq.count()) {
  console.log("click QQ");
  await qq.click().catch((e) => console.log("click fail", e.message));
  await page.waitForTimeout(5000);
}

await page.mouse.wheel(0, 1200);
await page.waitForTimeout(3000);

// 从 DOM 抓价格卡片
const cards = await page.evaluate(() => {
  const text = document.body.innerText;
  const prices = [...text.matchAll(/¥\s*([\d.]+)/g)].map((m) => m[1]);
  const links = [...document.querySelectorAll('a[href*="goodsDetails"], a[href*="goodsDetail"]')]
    .slice(0, 20)
    .map((a) => ({ href: a.href, text: (a.innerText || "").slice(0, 80) }));
  return {
    priceCount: prices.length,
    prices: prices.slice(0, 30),
    links,
    hasCaptcha: /验证|滑动|captcha|waf/i.test(text),
  };
});

console.log("dom:", cards);
await page.screenshot({ path: path.join(outDir, "debug-trigger.png"), fullPage: true });
fs.writeFileSync(path.join(outDir, "debug-hits.json"), JSON.stringify({ hits, cards }, null, 2));

await browser.close();
