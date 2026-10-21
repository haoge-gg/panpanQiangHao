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
  if (!/goodsPublic\/page|public\/goods/i.test(req.url())) return;
  const h = req.headers();
  captured.push({
    url: req.url(),
    Random: h.random,
    Sign: h.sign,
    post: req.postData()?.slice(0, 350),
  });
});
page.on("response", async (res) => {
  if (!res.url().includes("goodsPublic/page")) return;
  const t = await res.text().catch(() => "");
  captured.push({
    type: "res",
    status: res.status(),
    signed: !!res.request().headers().sign,
    head: t.slice(0, 120).replace(/\s+/g, " "),
  });
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(5000);

const result = await Promise.race([
  page.evaluate(async () => {
    const api = window.$nuxt.$api;
    const reqApi = window.$nuxt.$requestApi;
    const keys = Object.keys(api);
    const interesting = keys.filter((k) =>
      /goods|Goods|page|Page|list|List|search|Search|public/i.test(k)
    );

    // 打印几个方法的源码找 url
    const samples = {};
    for (const k of interesting.slice(0, 60)) {
      try {
        samples[k] = Function.prototype.toString.call(api[k]).slice(0, 300);
      } catch {
        samples[k] = typeof api[k];
      }
    }

    // 专门找 page
    const pageKeys = keys.filter((k) => /page|Page/.test(k));
    const pageSamples = {};
    for (const k of pageKeys) {
      try {
        pageSamples[k] = Function.prototype.toString.call(api[k]).slice(0, 400);
      } catch {}
    }

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

    const tries = [];
    async function attempt(label, fn) {
      try {
        const res = await Promise.race([
          fn(),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("timeout")), 25000)
          ),
        ]);
        const raw = res?.data ?? res;
        const isHtml =
          typeof raw === "string" && /aliyun_waf|doctype/i.test(raw);
        const data = raw?.data ?? raw;
        const list =
          data?.records || data?.list || data?.goodsList || data?.rows || [];
        tries.push({
          label,
          ok: true,
          isHtml,
          success: raw?.success,
          code: raw?.code,
          info: raw?.info,
          listLen: Array.isArray(list) ? list.length : -1,
          total: data?.total,
          head: isHtml ? "WAF" : JSON.stringify(raw)?.slice(0, 300),
        });
      } catch (e) {
        tries.push({ label, ok: false, error: e.message });
      }
    }

    // 正确调用 $requestApi
    await attempt("requestApi", () =>
      reqApi({
        url: "/api/web-client/v2/public/goodsPublic/page",
        method: "post",
        data: body,
      })
    );

    // 若有明显的 list 方法
    for (const name of [
      "getGoodsList",
      "goodsList",
      "goodsPage",
      "getGoodsPage",
      "publicGoodsPage",
      "listGoods",
      "searchGoods",
      "getAllTopGoods",
    ]) {
      if (typeof api[name] === "function") {
        await attempt(name, () => api[name](body));
      }
    }

    // 扫源码含 goodsPublic/page 的方法
    const hitMethods = [];
    for (const k of keys) {
      try {
        const src = Function.prototype.toString.call(api[k]);
        if (src.includes("goodsPublic/page") || src.includes("goodsPublic")) {
          hitMethods.push({
            k,
            src: src.slice(0, 350),
          });
        }
      } catch {}
    }

    for (const h of hitMethods.slice(0, 5)) {
      await attempt("api." + h.k, () => api[h.k](body));
    }

    return {
      keyCount: keys.length,
      interesting,
      pageKeys,
      pageSamples,
      hitMethods,
      tries,
    };
  }),
  new Promise((r) => setTimeout(() => r({ error: "outer" }), 90000)),
]);

fs.writeFileSync(
  "data/api-methods.json",
  JSON.stringify({ result, captured }, null, 2)
);
console.log(JSON.stringify(result, null, 2));
console.log("captured", JSON.stringify(captured, null, 2));
await browser.close();
process.exit(0);
