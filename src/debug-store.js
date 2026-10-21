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
await page.waitForTimeout(4000);

const result = await Promise.race([
  page.evaluate(async () => {
    const store = window.$nuxt?.$store;
    if (!store) return { error: "no store" };

    const actions = Object.keys(store._actions || {}).filter((k) =>
      /goods|Goods|list|List|filter|Filter/i.test(k)
    );

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

    // 直接看 GoodsListKey 怎么用
    let dispatchResult = null;
    let dispatchError = null;
    try {
      dispatchResult = await Promise.race([
        store.dispatch("game/GoodsListKey", body),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("dispatch timeout")), 25000)
        ),
      ]);
    } catch (e) {
      dispatchError = e.message || String(e);
    }

    return {
      actions,
      dispatchError,
      dispatchType: typeof dispatchResult,
      dispatchKeys:
        dispatchResult && typeof dispatchResult === "object"
          ? Object.keys(dispatchResult)
          : null,
      dispatchHead: JSON.stringify(dispatchResult)?.slice(0, 400),
    };
  }),
  new Promise((resolve) =>
    setTimeout(() => resolve({ error: "page.evaluate outer timeout" }), 35000)
  ),
]);

fs.writeFileSync("data/store-debug.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
process.exit(0);
