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

const hits = [];
page.on("request", (req) => {
  const u = req.url();
  if (/goodsPublic\/page|GoodsList|goods\/page/i.test(u)) {
    hits.push({
      method: req.method(),
      url: u,
      post: req.postData()?.slice(0, 400),
      sign: req.headers().sign,
      random: req.headers().random,
    });
  }
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(3000);

const result = await Promise.race([
  page.evaluate(async () => {
    const ax = window.$nuxt.$axios;
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

    // 找所有 script src，看是否能定位接口字符串
    const scripts = [...document.querySelectorAll("script[src]")]
      .map((s) => s.src)
      .filter((s) => /_nuxt|chunk|app/i.test(s))
      .slice(0, 30);

    async function tryPost(label, url, data, timeout = 15000) {
      try {
        const res = await Promise.race([
          ax.post(url, data),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), timeout)
          ),
        ]);
        const raw = res?.data;
        const isHtml = typeof raw === "string" && /aliyun_waf|doctype/i.test(raw);
        const payload = raw?.data ?? raw;
        const list =
          payload?.records ||
          payload?.list ||
          payload?.goodsList ||
          payload?.rows ||
          [];
        return {
          label,
          url,
          ok: true,
          isHtml,
          success: raw?.success,
          code: raw?.code,
          info: raw?.info,
          listLen: Array.isArray(list) ? list.length : -1,
          total: payload?.total ?? payload?.count,
          head: isHtml
            ? "WAF_HTML"
            : JSON.stringify(raw)?.slice(0, 220),
        };
      } catch (e) {
        return {
          label,
          url,
          ok: false,
          error: e.message,
          head:
            typeof e.response?.data === "string"
              ? e.response.data.slice(0, 120)
              : JSON.stringify(e.response?.data)?.slice(0, 120),
        };
      }
    }

    const tries = [];
    // 相对路径（走站内代理/拦截器）
    tries.push(
      await tryPost(
        "relative",
        "/api/web-client/v2/public/goodsPublic/page",
        body
      )
    );
    // 绝对 api 域名
    tries.push(
      await tryPost(
        "api-host",
        "https://api.pzds.com/api/web-client/v2/public/goodsPublic/page",
        body
      )
    );
    // secapi
    tries.push(
      await tryPost(
        "secapi",
        "https://secapi.pzds.com/api/web-client/v2/public/goodsPublic/page",
        body
      )
    );

    return { scripts: scripts.slice(0, 10), tries };
  }),
  new Promise((resolve) =>
    setTimeout(() => resolve({ error: "outer timeout" }), 50000)
  ),
]);

fs.writeFileSync(
  "data/find-api.json",
  JSON.stringify({ result, hits }, null, 2)
);
console.log(JSON.stringify({ result, hits }, null, 2));
await browser.close();
process.exit(0);
