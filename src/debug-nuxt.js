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
const page = await (
  await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "zh-CN",
  })
).newPage();

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2500);

const dump = await page.evaluate(() => {
  const nuxt = window.__NUXT__;
  const out = { topKeys: Object.keys(nuxt || {}), finds: [] };

  function walk(node, trail) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      if (
        node.length > 0 &&
        typeof node[0] === "object" &&
        node[0] &&
        ("price" in node[0] || "goodsPrice" in node[0] || "title" in node[0])
      ) {
        out.finds.push({
          trail,
          len: node.length,
          sample: node[0],
          keys: Object.keys(node[0] || {}),
        });
      }
      node.forEach((n, i) => {
        if (i < 5) walk(n, trail + `[${i}]`);
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (["price", "records", "list", "goodsList", "pageList"].includes(k) || /goods|record/i.test(k)) {
        const preview = Array.isArray(v)
          ? { type: "array", len: v.length, first: v[0] }
          : typeof v === "object" && v
            ? { type: "object", keys: Object.keys(v).slice(0, 20) }
            : { type: typeof v, value: v };
        out.finds.push({ trail: trail + "." + k, preview });
      }
      if (trail.split(".").length < 8) walk(v, trail + "." + k);
    }
  }

  walk(nuxt, "__NUXT__");

  // DOM 解析备用
  const cards = [...document.querySelectorAll(".goods-list-big a, .goods-list-big [class*='goods']")];
  out.domCardCount = cards.length;

  const items = [];
  const root = document.querySelector(".goods-list-big") || document.body;
  const blocks = [...root.querySelectorAll("a[href*='goodsDetails'], a[href*='goodsDetail']")];
  for (const a of blocks.slice(0, 30)) {
    const box = a.closest("[class]") || a;
    const text = (box.innerText || "").replace(/\s+/g, " ").trim();
    const price = text.match(/¥\s*([\d,.]+)/)?.[1];
    items.push({
      href: a.href,
      title: text.slice(0, 100),
      price,
    });
  }
  out.domItems = items;
  return out;
});

fs.writeFileSync(path.join(outDir, "debug-nuxt.json"), JSON.stringify(dump, null, 2));
console.log("topKeys", dump.topKeys);
console.log("finds", dump.finds.length);
for (const f of dump.finds.slice(0, 15)) {
  console.log("---");
  console.log(JSON.stringify(f).slice(0, 500));
}
console.log("domItems", dump.domItems?.slice(0, 5));

await browser.close();
