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
const page = await (await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "zh-CN",
})).newPage();

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2000);

const html = await page.content();
fs.writeFileSync(path.join(outDir, "debug-ssr.html"), html);

const nuxt = await page.evaluate(() => {
  const scripts = [...document.querySelectorAll("script")].map((s) => s.textContent || "");
  const interesting = scripts.filter((t) =>
    /goods|price|records|__NUXT|pinia|window\.__/i.test(t)
  );
  return {
    scriptCount: scripts.length,
    interestingLens: interesting.map((t) => t.length),
    interestingHeads: interesting.slice(0, 5).map((t) => t.slice(0, 300)),
    hasNuxt: !!(window.__NUXT__ || window.__NUXT),
    keys: Object.keys(window).filter((k) => /nuxt|pinia|pz|goods|__INITIAL/i.test(k)),
  };
});

console.log(JSON.stringify(nuxt, null, 2));

// DOM 商品卡
const dom = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll("[class*='goods'],[class*='Goods'],[class*='card'],[class*='list']")];
  return {
    candidateCount: candidates.length,
    sampleClass: candidates.slice(0, 15).map((el) => el.className?.toString?.().slice(0, 80)),
    textPrices: [...document.body.innerText.matchAll(/¥\s*([\d,.]+)/g)].map((m) => m[0]).slice(0, 20),
  };
});
console.log(JSON.stringify(dom, null, 2));

await browser.close();
