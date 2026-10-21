import fs from "node:fs";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});
const page = await (
  await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
).newPage();

const reqs = [];
page.on("request", (req) => {
  if (req.method() !== "POST") return;
  if (!/pzds\.com\/api|secapi|mcs\.pzds/.test(req.url())) return;
  const h = req.headers();
  reqs.push({
    url: req.url(),
    post: req.postData()?.slice(0, 180),
    Random: h.random || h.Random,
    Sign: h.sign || h.Sign,
    PZTimestamp: h.pztimestamp || h.PZTimestamp,
    contentType: h["content-type"],
  });
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(5000);

const out = await Promise.race([
  page.evaluate(async () => {
    const store = window.$nuxt.$store;
    const ax = window.$nuxt.$axios;

    // 1) 成功过的 action
    const r1 = await store.dispatch("game/GoodsListKey", {
      order: "ASC",
      page: 1,
      pageSize: 10,
    }).catch((e) => ({ err: e.message }));

    // 2) 等一会看拦截器
    await new Promise((r) => setTimeout(r, 1000));

    // 3) 用和其它成功请求一样的 content-type / 路径风格
    // 看 defaults transform
    const defaults = {
      baseURL: ax.defaults.baseURL,
      timeout: ax.defaults.timeout,
      transformRequest: !!ax.defaults.transformRequest,
      adapter: typeof ax.defaults.adapter,
    };

    // 4) 直接调用一个已知成功的 public 接口对比 headers
    let r2 = null;
    try {
      r2 = await Promise.race([
        ax.post("/api/web-client/v2/public/sys/get/config/batch", {
          keys: ["1"],
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 10000)),
      ]);
      r2 = { success: r2?.data?.success, code: r2?.data?.code };
    } catch (e) {
      r2 = { err: e.message };
    }

    return { r1, r2, defaults };
  }),
  new Promise((r) => setTimeout(() => r({ error: "timeout" }), 30000)),
]);

fs.writeFileSync("data/compare.json", JSON.stringify({ out, reqs }, null, 2));
console.log(JSON.stringify({ out, reqs: reqs.slice(-15) }, null, 2));
await browser.close();
process.exit(0);
