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

page.on("response", async (res) => {
  if (res.url().includes("goodsPublic/page")) {
    const t = await res.text().catch(() => "");
    console.log("NET", res.status(), res.url().slice(0, 120), t.slice(0, 80).replace(/\s+/g, " "));
  }
});

await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(3000);

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

  const axios = window.$nuxt?.$axios;
  if (!axios) return { ok: false, error: "no $axios" };

  try {
    const res = await axios.post(
      "/api/web-client/v2/public/goodsPublic/page",
      body
    );
    const data = res?.data?.data ?? res?.data;
    const list =
      data?.records || data?.list || data?.goodsList || data?.rows || [];
    return {
      ok: true,
      status: res?.status,
      success: res?.data?.success,
      code: res?.data?.code,
      keys: data && typeof data === "object" ? Object.keys(data) : [],
      listLen: Array.isArray(list) ? list.length : -1,
      total: data?.total ?? data?.count ?? null,
      sample: Array.isArray(list) ? list[0] : null,
      rawType: typeof res?.data,
      rawHead:
        typeof res?.data === "string"
          ? res.data.slice(0, 200)
          : JSON.stringify(res?.data)?.slice(0, 300),
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      responseHead:
        typeof e?.response?.data === "string"
          ? e.response.data.slice(0, 200)
          : JSON.stringify(e?.response?.data)?.slice(0, 300),
      status: e?.response?.status,
    };
  }
});

fs.writeFileSync("data/axios-page-debug.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
