#!/usr/bin/env node

/**
 * scrape_bricklink_mocs.js
 * Scrapes free / downloadable MOC models in pure LDraw (.ldr) format
 * from BrickLink Studio Gallery into docs/mocs/
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function evpBytesToKey(password, keyLen, ivLen) {
  let m = [];
  let d = Buffer.alloc(0);
  const passBuf = Buffer.from(password, "utf8");
  while (Buffer.concat(m).length < (keyLen + ivLen)) {
    d = crypto.createHash("md5").update(Buffer.concat([d, passBuf])).digest();
    m.push(d);
  }
  const buf = Buffer.concat(m);
  return { key: buf.subarray(0, keyLen), iv: buf.subarray(keyLen, keyLen + ivLen) };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: 50,
    out: path.resolve(__dirname, "../docs/mocs"),
    category: 0,   // 0 = all
    sort: 4,       // 4 = most downloaded, 0 = newest
    delay: 1000,   // ms between downloads
    startPage: 1,
    dryRun: false,
    query: ""
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--limit" && args[i + 1]) {
      const v = parseInt(args[++i], 10);
      opts.limit = v <= 0 ? Infinity : v;
    } else if (a === "--unlimited") {
      opts.limit = Infinity;
    } else if (a === "--start-page" && args[i + 1]) {
      opts.startPage = Math.max(1, parseInt(args[++i], 10));
    } else if (a === "--out" && args[i + 1]) {
      opts.out = path.resolve(args[++i]);
    } else if (a === "--category" && args[i + 1]) {
      opts.category = parseInt(args[++i], 10);
    } else if (a === "--sort" && args[i + 1]) {
      opts.sort = parseInt(args[++i], 10);
    } else if (a === "--delay" && args[i + 1]) {
      opts.delay = parseInt(args[++i], 10);
    } else if (a === "--query" && args[i + 1]) {
      opts.query = args[++i];
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/scrape_bricklink_mocs.js [options]

Options:
  --limit <n>      Max number of models to download (0 = unlimited, default: 50)
  --unlimited      Download all available downloadable models without limit
  --start-page <n> Gallery page to start from (default: 1)
  --out <dir>      Output directory (default: docs/mocs)
  --category <id>  Category ID (default: 0 for all)
  --sort <id>      Sort mode: 4 = Most Downloaded (default), 0 = Newest
  --query <str>    Search keyword filter
  --delay <ms>     Delay between downloads in ms (default: 1000)
  --dry-run        List models without downloading
  --help           Show this message
`);
      process.exit(0);
    }
  }
  return opts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class BrickLinkSession {
  constructor() {
    this.cookieHeader = "";
    this.idSession = "";
    this.key = null;
    this.serverTime = null;
    this.sessionCreatedTime = 0;
  }

  async init() {
    console.log("  [Session] Negotiating fresh BrickLink session...");
    const resp = await fetch("https://www.bricklink.com/v3/studio/gallery.page", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const rawCookies = resp.headers.getSetCookie();
    this.cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");
    const html = await resp.text();
    const m = html.match(/"idSession"\s*:\s*"([A-F0-9]+)"/);
    if (!m) throw new Error("Could not extract idSession from BrickLink gallery page");
    this.idSession = m[1];
    const { key } = evpBytesToKey(this.idSession, 16, 0);
    this.key = key;
    this.sessionCreatedTime = Date.now();

    await this.fetchServerTime();
    console.log("  [Session] Connected. Session ID: " + this.idSession);
  }

  isSessionStale() {
    // Proactively refresh after 45 minutes
    return Date.now() - this.sessionCreatedTime > 45 * 60 * 1000;
  }

  encrypt(payloadObj) {
    const cipher = crypto.createCipheriv("aes-128-ecb", this.key, null);
    return cipher.update(JSON.stringify(payloadObj), "utf8", "hex") + cipher.final("hex");
  }

  async callAjax(fetchList, retry = true) {
    try {
      if (this.isSessionStale()) {
        await this.init();
      }

      const enc = this.encrypt({ fetch_list: JSON.stringify(fetchList) });
      const postResp = await fetch("https://www.bricklink.com/_ajax/getModels.ajax", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Cookie": this.cookieHeader,
          "Referer": "https://www.bricklink.com/v3/studio/gallery.page",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: new URLSearchParams({ secured_input: enc })
      });
      const data = await postResp.json();
      if (data.returnCode === "EC_INVALID_ACCESS" && retry) {
        console.log("  [Session] Access expired, re-initializing session...");
        await this.init();
        return await this.callAjax(fetchList, false);
      }
      return data;
    } catch (err) {
      if (retry) {
        console.log(`  [Network] Ajax error: ${err.message}. Retrying in 5s...`);
        await sleep(5000);
        await this.init();
        return await this.callAjax(fetchList, false);
      }
      throw err;
    }
  }

  async fetchServerTime() {
    const res = await this.callAjax([{
      name: "_serverTime",
      controller: "common.BLCSystemData",
      method: "getServerTime",
      params: []
    }]);
    this.serverTime = res?.models?.[0]?.data || Date.now();
    return this.serverTime;
  }

  async fetchModelsPage(page, pageSize, sortMethod, category, query, maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.callAjax([{
          name: "_updateGallerySearch",
          controller: "studio.BLCUserModel",
          method: "getModelList",
          params: [page, pageSize, sortMethod, 1, 0, 0, category, query, 0]
        }]);
        if (res.models && res.models[0] && res.models[0].data) {
          return res.models[0].data;
        }
        return { arrModels: [], nTotalCnt: 0 };
      } catch (err) {
        console.log(`  [Page Error] Page ${page} failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
        if (attempt < maxRetries) {
          const waitTime = attempt * 5000;
          console.log(`  Waiting ${waitTime / 1000}s before retrying page...`);
          await sleep(waitTime);
          await this.init().catch(() => {});
        } else {
          throw err;
        }
      }
    }
  }

  async downloadModelLdr(idModel, retry = true) {
    const ts = Date.now();
    const encModel = this.encrypt({ idModel: idModel, ts: ts, type: "gallery" });
    const resp = await fetch(`https://www.bricklink.com/_file/studio/modelView.file?k=${encModel}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": this.cookieHeader,
        "Referer": "https://www.bricklink.com/v3/studio/gallery.page"
      }
    });

    const content = await resp.text();
    if (content.startsWith("Error")) {
      if (retry && (content.includes("Session") || content.includes("Login"))) {
        console.log("  [Session] Re-initializing session for download...");
        await this.init();
        return await this.downloadModelLdr(idModel, false);
      }
      throw new Error(content.trim());
    }
    return content;
  }
}

async function main() {
  const opts = parseArgs();
  console.log(`[BrickLink Scraper] Initializing... Target dir: ${opts.out}`);
  console.log(`[BrickLink Scraper] Limit: ${opts.limit === Infinity ? "UNLIMITED (All available models)" : opts.limit}`);
  console.log(`[BrickLink Scraper] Starting from page: ${opts.startPage}`);

  if (!fs.existsSync(opts.out)) {
    fs.mkdirSync(opts.out, { recursive: true });
  }

  const manifestPath = path.join(opts.out, "manifest.json");
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      manifest = {};
    }
  }

  function saveManifest() {
    const tmpPath = `${manifestPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf8");
    fs.renameSync(tmpPath, manifestPath);
  }

  process.on("SIGINT", () => {
    console.log("\n[BrickLink Scraper] Interrupted. Saving manifest before exit...");
    saveManifest();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    saveManifest();
    process.exit(0);
  });

  const session = new BrickLinkSession();
  await session.init();

  let downloadedCount = 0;
  let skippedCount = 0;
  let nonDownloadableCount = 0;
  let page = opts.startPage;
  const pageSize = 20;
  let totalModelsReported = null;

  while (downloadedCount < opts.limit) {
    console.log(`\n--- Fetching Gallery Page ${page} (Downloaded: ${downloadedCount}, Skipped: ${skippedCount}) ---`);
    const pageData = await session.fetchModelsPage(page, pageSize, opts.sort, opts.category, opts.query);
    const models = pageData.arrModels || [];
    if (totalModelsReported === null && pageData.nTotalCnt) {
      totalModelsReported = pageData.nTotalCnt;
      console.log(`Total models in gallery query: ${totalModelsReported}`);
    }

    if (models.length === 0) {
      console.log(`[BrickLink Scraper] Reached end of gallery. No more models found.`);
      break;
    }

    let modifiedManifest = false;

    for (const m of models) {
      if (downloadedCount >= opts.limit) break;

      const idModel = m.idModel;
      const title = m.strModelName;
      const isDownloadable = !!m.bDownloadable;

      if (!isDownloadable) {
        nonDownloadableCount++;
        continue;
      }

      const safeName = title.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").slice(0, 50);
      const filename = `${idModel}_${safeName}.ldr`;
      const filePath = path.join(opts.out, filename);

      if (fs.existsSync(filePath)) {
        skippedCount++;
        if (!manifest[idModel]) {
          manifest[idModel] = {
            idModel,
            title,
            author: m.dmUserBuilder?.dmUser?.skUsername || "unknown",
            downloads: m.nDownCnt,
            views: m.nViewCnt,
            filename
          };
          modifiedManifest = true;
        }
        continue;
      }

      if (opts.dryRun) {
        console.log(`[Dry-Run] Would download [${idModel}] "${title}" (${m.nDownCnt} downloads) -> ${filename}`);
        downloadedCount++;
        continue;
      }

      process.stdout.write(`- [${idModel}] Downloading "${title}" (${m.nDownCnt} DLs)... `);
      try {
        const content = await session.downloadModelLdr(idModel);
        fs.writeFileSync(filePath, content, "utf8");
        const lines = content.split("\n").length;
        console.log(`OK (${(content.length / 1024).toFixed(1)} KB, ${lines} lines)`);

        manifest[idModel] = {
          idModel,
          title,
          author: m.dmUserBuilder?.dmUser?.skUsername || "unknown",
          downloads: m.nDownCnt,
          views: m.nViewCnt,
          filename,
          sizeBytes: content.length,
          lineCount: lines,
          downloadedAt: new Date().toISOString()
        };
        modifiedManifest = true;
        downloadedCount++;
        await sleep(opts.delay);
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
      }
    }

    if (modifiedManifest) {
      saveManifest();
    }

    page++;
    await sleep(opts.delay);
  }

  saveManifest();
  console.log(`\n======================================================`);
  console.log(`[BrickLink Scraper] Job Finished!`);
  console.log(`Downloaded: ${downloadedCount}`);
  console.log(`Skipped existing: ${skippedCount}`);
  console.log(`Total in manifest: ${Object.keys(manifest).length}`);
  console.log(`======================================================`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
