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

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(6000);

const result = await page.evaluate(async () => {
  const ax = window.$nuxt.$axios;
  const handlers = (ax.interceptors.request.handlers || []).filter(Boolean);

  const infos = handlers.map((h, i) => {
    const fn = h.fulfilled;
    return {
      i,
      fnType: typeof fn,
      fnLen: fn?.length,
      src: fn ? Function.prototype.toString.call(fn).slice(0, 800) : null,
    };
  });

  // 找 $api / request 封装
  const nuxtKeys = Object.keys(window.$nuxt).filter((k) =>
    /api|http|axios|request|fetch/i.test(k)
  );
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(window.$nuxt) || {}).filter(
    (k) => /api|http|axios|request/i.test(k)
  );

  // 试着手动跑 request interceptor 看 config 会被改成什么
  let transformed = null;
  try {
    const config = {
      url: "/api/web-client/v2/public/goodsPublic/page",
      method: "post",
      data: {
        order: "ASC",
        page: 1,
        pageSize: 1000,
        action: { gameId: 231, goodsCatalogueId: 6 },
      },
      headers: { common: {}, post: {} },
    };
    let cfg = config;
    for (const h of handlers) {
      if (typeof h.fulfilled === "function") {
        cfg = await h.fulfilled(cfg);
      }
    }
    transformed = {
      url: cfg.url,
      baseURL: cfg.baseURL,
      headers: cfg.headers,
      params: cfg.params,
    };
  } catch (e) {
    transformed = { error: e.message, stack: String(e.stack).slice(0, 400) };
  }

  // axios 自定义方法
  const axKeys = Object.keys(ax).filter((k) => typeof ax[k] === "function");

  return { infos, nuxtKeys, proto, transformed, axKeys: axKeys.slice(0, 40) };
});

fs.writeFileSync("data/interceptor.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(0);
