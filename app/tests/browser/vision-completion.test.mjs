import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { boardScript } from "./fixtures/redesign-fixture.mjs";
import { makeRedesignMock } from "./fixtures/redesign-mock.mjs";
import { build } from "vite";
import {
  ZipReader,
  Uint8ArrayReader,
  TextWriter,
} from "@zip.js/zip.js/lib/zip-core-native.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const chrome =
  process.env.CHROME_BIN ||
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(existsSync);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lastCheckpoint = "initialization";
async function until(read, description, attempts = 150) {
  lastCheckpoint = description;
  for (let i = 0; i < attempts; i++) {
    const result = await read();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function connect(
  url,
  {
    timeoutMs = 20000,
    socketFactory = (address) => new WebSocket(address),
  } = {},
) {
  const socket = socketFactory(url),
    pending = new Map(),
    events = [];
  let next = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("DevTools connection timed out."));
    }, timeoutMs);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
      { once: true },
    );
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data),
      handler = pending.get(message.id);
    if (!handler) {
      if (
        [
          "Runtime.consoleAPICalled",
          "Runtime.exceptionThrown",
          "Log.entryAdded",
          "Page.downloadWillBegin",
          "Page.downloadProgress",
        ].includes(message.method)
      )
        events.push(message);
      return;
    }
    pending.delete(message.id);
    message.error
      ? handler.reject(new Error(message.error.message))
      : handler.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const entry of pending.values())
      entry.reject(new Error("DevTools connection closed."));
    pending.clear();
  });
  return {
    events,
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(`DevTools ${method} timed out after ${lastCheckpoint}.`),
          );
        }, timeoutMs);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    },
    close() {
      socket.close();
    },
  };
}

async function stopBrowser(browser) {
  if (!browser || browser.exitCode !== null || browser.signalCode !== null)
    return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      browser.removeListener("exit", finish);
      resolve();
    };
    const timer = setTimeout(() => {
      browser.kill("SIGKILL");
      finish();
    }, 5000);
    browser.once("exit", finish);
    browser.kill();
    if (browser.exitCode !== null || browser.signalCode !== null) finish();
  });
}

async function evaluate(client, expression) {
  const response = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text,
    );
  return response.result.value;
}

test(
  "Completed unusable analysis stays billable without UNKNOWN hold, preserves review outputs and never retries",
  { timeout: 180000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "studio-pages-")),
      out = join(root, "dist"),
      profile = join(root, "profile"),
      base = "/PWA-AI-Product-Image-Studio-BYOK/";
    let server, browser, tab;
    const requests = [];
    try {
      await build({
        root: appRoot,
        configFile: join(appRoot, "vite.config.ts"),
        mode: "pages",
        base,
        logLevel: "silent",
        build: { outDir: out },
      });
      await mkdir(profile);
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webmanifest": "application/manifest+json",
      };
      server = createServer(async (req, res) => {
        requests.push(req.url);
        try {
          const path = new URL(req.url, "http://localhost").pathname;
          assert.ok(path.startsWith(base));
          const name = path.slice(base.length) || "index.html";
          assert.ok(!name.includes(".."));
          const bytes = await readFile(join(out, name));
          res.writeHead(200, {
            "content-type": types[extname(name)] || "application/octet-stream",
            "cache-control": "no-store",
          });
          res.end(bytes);
        } catch {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${server.address().port}`,
        url = `${origin}${base}#/settings`;
      browser = spawn(
        chrome,
        [
          "--headless=new",
          ...(process.platform === "linux"
            ? ["--no-sandbox", "--disable-dev-shm-usage"]
            : []),
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "--no-first-run",
          "--disable-background-networking",
          "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let chromeDiagnostics = "";
      browser.stderr.on("data", (chunk) => {
        chromeDiagnostics = (chromeDiagnostics + chunk.toString()).slice(-4000);
      });
      browser.on("error", (error) => {
        chromeDiagnostics = error.message;
      });
      const port = await until(async () => {
        try {
          return Number(
            (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split(
              "\n",
            )[0],
          );
        } catch {
          if (browser.exitCode !== null)
            throw new Error(
              `Chrome startup failed (${browser.exitCode}): ${chromeDiagnostics}`,
            );
          return null;
        }
      }, "Chrome");
      const list = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      tab = await connect(
        list.find((x) => x.type === "page").webSocketDebuggerUrl,
      );
      await tab.call("Page.enable");
      await tab.call("Runtime.enable");
      await tab.call("Page.navigate", { url });

      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[type=password]')&&!document.querySelector('input[type=password]').disabled`,
          ),
        "key settings",
      );
      await evaluate(
        tab,
        `(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [selector,value] of [['input[type=password]','sk-synthetic-reference-browser-only']]){const e=document.querySelector(selector);set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form input[type=checkbox]').click()})()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `!document.querySelector('form button[type=submit]').disabled`,
          ),
        "authorized setup form",
      );
      await evaluate(
        tab,
        `document.querySelector('form button[type=submit]').click()`,
      );
      await until(
        () =>
          evaluate(tab, `document.body.innerText.includes('Ready to create.')`),
        "key/session set",
      );
      await evaluate(tab, `location.hash='#/'`);
      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[name=automatic-mode]')`,
          ),
        "mode control",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('input[name=automatic-mode]').checked`,
        ),
        true,
        "STRICT stays default",
      );
      await evaluate(
        tab,
        `document.querySelectorAll('input[name=automatic-mode]')[1].click()`,
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('input[aria-label="Upload product image"]').disabled`,
        ),
        true,
        "Separate tab transmission consent is required",
      );
      await evaluate(tab, makeRedesignMock());
      const pixel = {
        classification: "single-product",
        confidence: 0.99,
        primaryId: "shoe_0",
        subjects: [
          {
            id: "shoe_0",
            group: "g0",
            imageIndex: 0,
            box: { x: 27, y: 44, width: 968, height: 597 },
            detailBox: { x: 416, y: 242, width: 86, height: 86 },
            confidence: 0.99,
            category: "footwear",
            camera: "three-quarter",
            views: [],
          },
        ],
        textRegions: [],
      };
      await evaluate(
        tab,
        `document.querySelector('.automatic-options input[type=checkbox]').click();window.__qaAnalysisOverride=${JSON.stringify(pixel)}`,
      );
      await evaluate(tab, boardScript());
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelector('.auto-results')?.innerText.includes('Analysis completed, but its subject regions could not be used.')&&!document.querySelector('.auto-upload.processing')`,
          ),
        "completed unusable source has actionable distinct message",
      );
      assert.equal(
        await evaluate(tab, `window.__qaRequests.length`),
        1,
        "Invalid analysis never sends an edit or automatically retries",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('.auto-results').innerText.includes('Billing review needed')`,
        ),
        false,
      );
      const history = await evaluate(
        tab,
        `(async()=>{const q=indexedDB.open('image-studio-automatic',3),db=await new Promise(r=>q.onsuccess=()=>r(q.result));try{return await new Promise(r=>{const q=db.transaction('runs').objectStore('runs').getAll();q.onsuccess=()=>r(q.result.map(run=>({aux:run.auxiliary.map(a=>({kind:a.kind,status:a.status,error:a.error})),images:run.items.map(i=>i.status)})))})}finally{db.close()}})()`,
      );
      assert.equal(history[0].aux[0].status, "FAILED");
      assert.equal(history[0].aux[0].error, "SOURCE_ANALYSIS_INVALID");
      assert.ok(history[0].images.every((s) => s === "NOT_SENT"));
      assert.equal(
        await evaluate(
          tab,
          `Object.values(JSON.parse(localStorage.getItem('studio.browser-byok.attempts.v1'))).every(a=>a.outcome==='DEFINITIVE_SUCCESS')`,
        ),
        true,
        "Completed unusable request is recorded as completed, not refunded or unknown",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload another').click();window.__qaAnalysisOverride=null;window.__qaFailPurpose='source-analysis'`,
      );
      await until(() => evaluate(tab, `!!document.querySelector('input[aria-label="Upload product image"]')&&!document.querySelector('input[aria-label="Upload product image"]').disabled`), "explicit unknown-source upload ready");
      await evaluate(tab, boardScript());
      await until(() => evaluate(tab, `window.__qaRequests.length===2&&!document.querySelector('.auto-upload.processing')&&document.querySelector('.auto-results')?.innerText.includes('Request interrupted')`), "unknown source outcome visible");
      assert.equal(await evaluate(tab, `document.querySelector('#auto-results-heading').textContent`), "0 downloadable");
      await delay(250);
      assert.equal(await evaluate(tab, `window.__qaRequests.length`), 2, "UNKNOWN is never automatically retried");
      assert.equal(await evaluate(tab, `(async()=>{const q=indexedDB.open('image-studio-automatic',3),db=await new Promise(r=>q.onsuccess=()=>r(q.result));try{return await new Promise(r=>{const q=db.transaction('runs').objectStore('runs').getAll();q.onsuccess=()=>r(q.result.some(run=>run.auxiliary.some(a=>a.kind==='source-analysis'&&a.status==='UNKNOWN'&&!a.reviewedAt)))})}finally{db.close()}})()`),true,"UNKNOWN history stays unreviewed and unchanged");
      await evaluate(tab, `[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload another').click()`);
      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[aria-label="Upload product image"]')&&!document.querySelector('input[aria-label="Upload product image"]').disabled`,
          ),
        "new explicit upload available without billing recovery",
      );
      await evaluate(tab, boardScript());
      await until(
        () =>
          evaluate(
            tab,
            `window.__qaRequests.length===10&&!document.querySelector('.auto-upload.processing')`,
          ),
        "normalized analysis succeeds on new explicit upload",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('#auto-results-heading').textContent`,
        ),
        "7 downloadable",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload another').click();window.__qaReviewOverride={findings:[]}`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[aria-label="Upload product image"]')`,
          ),
        "review-invalid upload controls",
      );
      await evaluate(tab, boardScript());
      await until(
        () =>
          evaluate(
            tab,
            `window.__qaRequests.length===18&&!document.querySelector('.auto-upload.processing')`,
          ),
        "completed invalid review preserves outputs",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('#auto-results-heading').textContent`,
        ),
        "7 downloadable",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('.gallery-quality-note').textContent.includes('Visual review completed, but its findings could not be used.')`,
        ),
        true,
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('.auto-results').innerText.includes('Billing review needed')`,
        ),
        false,
      );
      await delay(250);
      assert.equal(await evaluate(tab, `window.__qaRequests.length`), 18);
    } finally {
      tab?.close();
      await stopBrowser(browser);
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
