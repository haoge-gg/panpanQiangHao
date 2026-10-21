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
const page = await (
  await browser.newContext({
    locale: "zh-CN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  })
).newPage();

const propsWait = page.waitForResponse(
  (r) =>
    r.url().includes("search/properties") && r.request().method() === "POST",
  { timeout: 30000 }
);
await page.goto("https://www.pzds.com/goodsList/231/6?goodsCatalogueId=6", {
  waitUntil: "domcontentloaded",
});
const res = await propsWait;
const json = await res.json();
fs.writeFileSync(
  path.join(root, "data", "properties.json"),
  JSON.stringify(json, null, 2)
);

const data = json?.data ?? json;
const targets = ["6406", "7607", "12986", "可二次实名", "无封号", "QQ"];
const s = JSON.stringify(data);

for (const id of targets) {
  const i = s.indexOf(id);
  console.log("\n===", id, "idx", i);
  if (i >= 0) console.log(s.slice(Math.max(0, i - 120), i + 160));
}

// flatten options
const options = [];
function walk(node, trail = []) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => walk(n, trail.concat(i)));
    return;
  }
  const name =
    node.name ||
    node.propertyName ||
    node.label ||
    node.fieldName ||
    node.title;
  const id = node.id ?? node.propertyId ?? node.value ?? node.key;
  if (name && id != null) {
    options.push({
      trail: trail.join("."),
      id: String(id),
      name: String(name),
      fieldKey: node.fieldKey || node.field || node.metaKey || node.keyName,
      parentName: node.parentName,
    });
  }
  for (const [k, v] of Object.entries(node)) walk(v, trail.concat(k));
}
walk(data);

const interesting = options.filter((o) =>
  /QQ|微信|实名|封号|6406|7607|12986/.test(o.name + o.id + (o.fieldKey || ""))
);
console.log("\ninteresting options:", interesting.length);
for (const o of interesting) console.log(JSON.stringify(o));

await browser.close();
