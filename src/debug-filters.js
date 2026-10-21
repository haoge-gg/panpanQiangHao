import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(root, "data"), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  locale: "zh-CN",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1440, height: 1100 },
});
await context.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});
const page = await context.newPage();

const posts = [];
page.on("request", (req) => {
  if (
    req.method() === "POST" &&
    req.url().includes("/goodsPublic/page")
  ) {
    posts.push({
      url: req.url(),
      body: req.postData(),
      headers: req.headers(),
    });
    console.log("PAGE POST body:", req.postData()?.slice(0, 600));
  }
});

page.on("response", async (res) => {
  if (res.url().includes("/goodsPublic/page")) {
    const t = await res.text().catch(() => "");
    console.log("PAGE RES", res.status(), t.slice(0, 100).replace(/\s+/g, " "));
    fs.writeFileSync(
      path.join(root, "data", "filter-page-response.txt"),
      t.slice(0, 5000)
    );
  }
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2500);

async function clickExact(text) {
  const el = page.getByText(text, { exact: true }).first();
  await el.scrollIntoViewIfNeeded();
  await el.click({ timeout: 5000 });
  console.log("clicked", text);
  await page.waitForTimeout(2500);
}

await clickExact("QQ");
await clickExact("可二次实名");
await clickExact("无封号");
await page.waitForTimeout(4000);

const dom = await page.evaluate(() => {
  const list = window.__NUXT__?.data?.[0]?.goodsList || [];
  const cards = [...document.querySelectorAll("a[href*='goodsDetails']")].slice(0, 40);
  return {
    nuxtLen: list.length,
    nuxtSample: list.slice(0, 3).map((g) => ({
      goodsNo: g.goodsNo,
      price: g.price,
      subtitle: g.subtitle,
      simpleMessage: g.simpleMessage,
      title: g.title?.slice(0, 60),
    })),
    cardTexts: cards.map((a) => {
      const box = a.closest("div") || a;
      return {
        href: a.href,
        text: (box.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160),
      };
    }),
    bodyHasCaptcha: /验证|滑动|waf|人机/i.test(document.body.innerText),
  };
});

fs.writeFileSync(
  path.join(root, "data", "filter-debug.json"),
  JSON.stringify({ posts, dom }, null, 2)
);
await page.screenshot({
  path: path.join(root, "data", "filter-debug.png"),
  fullPage: true,
});
console.log(JSON.stringify(dom, null, 2).slice(0, 2500));
console.log("posts", posts.length);
await browser.close();
