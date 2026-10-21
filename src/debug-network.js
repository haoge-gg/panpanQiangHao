import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data");
fs.mkdirSync(outDir, { recursive: true });

const url =
  process.argv[2] ||
  "https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  locale: "zh-CN",
});

const requests = [];
page.on("request", (req) => {
  if (req.resourceType() === "xhr" || req.resourceType() === "fetch") {
    requests.push({
      method: req.method(),
      url: req.url(),
      type: req.resourceType(),
    });
  }
});

page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("goodsPublic") || u.includes("api.pzds") || u.includes("waf")) {
    console.log("RESP", res.status(), u.slice(0, 160));
  }
});

console.log("goto", url);
await page.goto(url, { waitUntil: "networkidle", timeout: 90000 }).catch((e) => {
  console.log("goto err:", e.message);
});

await page.waitForTimeout(5000);
await page.screenshot({ path: path.join(outDir, "debug-page.png"), fullPage: true });
fs.writeFileSync(
  path.join(outDir, "debug-requests.json"),
  JSON.stringify(requests, null, 2)
);

const title = await page.title();
const bodyText = await page.locator("body").innerText().catch(() => "");
console.log("title:", title);
console.log("body snippet:", bodyText.slice(0, 400).replace(/\s+/g, " "));
console.log("xhr/fetch count:", requests.length);
console.log(
  "api-ish:",
  requests.filter((r) => /api|goods|pzds/i.test(r.url)).slice(0, 30)
);

await browser.close();
