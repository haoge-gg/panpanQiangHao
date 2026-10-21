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

const urls = [];
page.on("request", (req) => {
  if (req.url().includes("goodsPublic") || req.url().includes("decode__")) {
    urls.push({ method: req.method(), url: req.url().slice(0, 200), headers: {
      Random: req.headers()["random"],
      Sign: req.headers()["sign"],
      PZTimestamp: req.headers()["pztimestamp"],
    }});
  }
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "networkidle",
  timeout: 90000,
}).catch(() => {});

// 等 wasm / 拦截器就绪
await page.waitForTimeout(8000);

const meta = await page.evaluate(() => {
  const ax = window.$nuxt?.$axios;
  return {
    baseURL: ax?.defaults?.baseURL,
    headers: ax?.defaults?.headers,
    interceptorsReq: !!ax?.interceptors?.request,
    storeKeys: window.$nuxt?.$store ? Object.keys(window.$nuxt.$store._actions || {}).slice(0, 50) : [],
  };
});
console.log("meta", JSON.stringify(meta, null, 2));

const result = await page.evaluate(async () => {
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

  const ax = window.$nuxt.$axios;
  // 试 api 域名绝对路径
  const endpoints = [
    "https://api.pzds.com/api/web-client/v2/public/goodsPublic/page",
    "/web-client/v2/public/goodsPublic/page",
    "/api/web-client/v2/public/goodsPublic/page",
  ];

  const outs = [];
  for (const url of endpoints) {
    try {
      const res = await ax.post(url, body, { timeout: 20000 });
      const data = res?.data;
      const isHtml = typeof data === "string" && data.includes("aliyun_waf");
      const payload = data?.data ?? data;
      const list =
        payload?.records ||
        payload?.list ||
        payload?.goodsList ||
        payload?.rows ||
        [];
      outs.push({
        url,
        status: res.status,
        isHtml,
        success: data?.success,
        listLen: Array.isArray(list) ? list.length : -1,
        total: payload?.total,
        head: isHtml
          ? "WAF"
          : JSON.stringify(data)?.slice(0, 180),
      });
      if (!isHtml && Array.isArray(list) && list.length) break;
    } catch (e) {
      outs.push({
        url,
        error: e.message,
        status: e.response?.status,
        head:
          typeof e.response?.data === "string"
            ? e.response.data.slice(0, 120)
            : JSON.stringify(e.response?.data)?.slice(0, 120),
      });
    }
  }
  return outs;
});

fs.writeFileSync(
  "data/axios2.json",
  JSON.stringify({ meta, result, urls }, null, 2)
);
console.log(JSON.stringify({ result, urls }, null, 2));
await browser.close();
