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

const captured = [];
page.on("request", (req) => {
  if (!req.url().includes("goodsPublic/page")) return;
  const h = req.headers();
  captured.push({
    url: req.url(),
    post: req.postData(),
    Random: h.random,
    Sign: h.sign,
    PZTimestamp: h.pztimestamp,
  });
});
page.on("response", async (res) => {
  if (!res.url().includes("goodsPublic/page")) return;
  const t = await res.text().catch(() => "");
  captured.push({
    type: "res",
    status: res.status(),
    url: res.url(),
    head: t.slice(0, 200).replace(/\s+/g, " "),
  });
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(5000);

// 在页面里找调用 goodsPublic/page 的封装：扫描 webpack modules 太重，
// 改用：复用 axios 实例，但走和 listGoodsPropertyConfig 相同的调用方式
const result = await Promise.race([
  page.evaluate(async () => {
    const ax = window.$nuxt.$axios;

    // 观察拦截器数量
    const handlers = ax.interceptors.request.handlers?.filter(Boolean) || [];

    const body = {
      order: "ASC",
      sort: null,
      page: 1,
      pageSize: 1000,
      action: {
        gameId: 231,
        merchantMark: null,
        keywords: [],
        searchWords: [],
        searchPropertyIds: [],
        recommendSearchConfigIds: [],
        unionGameIds: [],
        goodsSearchActions: [],
        metas: { single1: ["6406"] },
        goodsCatalogueId: 6,
        metadata: [],
        single6: "7607",
        single5: "12986",
        goodsSubCatalogueIds: [],
        countFlag: false,
        conditionSearch: true,
      },
    };

    // 先打一个肯定会签名的接口，确保 wasm 热
    await ax
      .post("/web-client/v2/public/goodsPublic/search/properties", {
        action: { gameId: 231 },
      })
      .catch(() => {});

    // Nuxt 代理路径通常是 /web-client/... 由环境配到 api.pzds.com
    // 对比两种 path 前缀
    const paths = [
      "/web-client/v2/public/goodsPublic/page",
      "/api/web-client/v2/public/goodsPublic/page",
    ];

    const tries = [];
    for (const p of paths) {
      try {
        const res = await Promise.race([
          ax.post(p, body),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 20000)
          ),
        ]);
        const raw = res.data;
        const isHtml =
          typeof raw === "string" && /aliyun_waf|doctype/i.test(raw);
        const data = raw?.data ?? raw;
        const list =
          data?.records || data?.list || data?.goodsList || data?.rows || [];
        tries.push({
          path: p,
          ok: true,
          isHtml,
          success: raw?.success,
          listLen: Array.isArray(list) ? list.length : -1,
          total: data?.total,
          head: isHtml ? "WAF" : JSON.stringify(raw)?.slice(0, 250),
        });
      } catch (e) {
        tries.push({ path: p, ok: false, error: e.message });
      }
    }

    return { interceptorCount: handlers.length, tries };
  }),
  new Promise((r) => setTimeout(() => r({ error: "outer" }), 55000)),
]);

fs.writeFileSync(
  "data/signed-page.json",
  JSON.stringify({ result, captured }, null, 2)
);
console.log(JSON.stringify({ result, captured }, null, 2));
await browser.close();
process.exit(0);
