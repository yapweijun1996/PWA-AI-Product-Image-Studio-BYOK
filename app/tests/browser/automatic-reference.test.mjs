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
  "Reference board is analyzed once, cropped without annotations, reviewed and explicitly regenerated with immutable history",
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
      await evaluate(tab, boardScript());
      await delay(100);
      assert.equal(
        await evaluate(tab, `window.__qaRequests.length`),
        0,
        "No source analysis without consent",
      );
      await evaluate(
        tab,
        `document.querySelector('.automatic-options input[type=checkbox]').click()`,
      );
      await evaluate(tab, boardScript());
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelectorAll('.gallery-open').length===7&&!document.querySelector('.auto-upload.processing')`,
          ),
        "board upload produces seven available looks",
      );
      const records = await evaluate(tab, `window.__qaRequests`);
      assert.equal(
        records.length,
        8,
        "Six image requests and two bounded auxiliary requests",
      );
      assert.deepEqual(
        records.filter((r) => r.purpose).map((r) => r.purpose),
        ["source-analysis", "output-review"],
      );
      assert.equal(records[0].images.length, 1);
      assert.equal(
        records.at(-1).images.length,
        8,
        "Two prepared references and six generated outputs",
      );
      for (const r of records.filter((r) => r.endpoint.endsWith("/edits"))) {
        assert.equal(r.images.length, 2);
        assert.ok(
          r.images.every((i) => i.magenta === 0),
          "No external specification pixels are sent in edits",
        );
        assert.ok(
          r.images.every((i) =>
            i.chunks.every((t) => ["IHDR", "IDAT", "IEND"].includes(t)),
          ),
        );
        assert.ok(!r.prompt.includes("private-"));
      }
      assert.deepEqual(await evaluate(tab, `window.__qaExternal`), []);
      const saved = await evaluate(
        tab,
        `(async()=>{const r=indexedDB.open('image-studio-automatic',3),db=await new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});try{const rows=await new Promise(resolve=>{const q=db.transaction('runs').objectStore('runs').getAll();q.onsuccess=()=>resolve(q.result)}),run=rows[0],hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');return {id:run.id,sourceHash:run.sourceSha256,originalHash:await hash(run.source),originalSize:run.source.size,detail:run.detail.roi,refs:run.preparedReferences.map(r=>({roi:r.roi,sha:r.sha256})),items:run.items.map(i=>({style:i.style,id:i.id,hash:i.sha256,semantic:i.semantic}))}}finally{db.close()}})()`,
      );
      assert.equal(saved.originalHash, saved.sourceHash);
      assert.equal(saved.refs.length, 2);
      assert.equal(saved.detail.width, 360);
      assert.equal(saved.detail.height, 360);
      assert.equal(saved.refs[0].roi.x, 120);
      assert.equal(saved.refs[0].roi.width, 760);
      assert.equal(
        saved.items.find((i) => i.style === "hero").semantic.identity,
        "conflict",
        "Machine identity conflict remains attention despite usable composition",
      );
      for (const width of [320, 390, 768, 1440]) {
        await tab.call("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width < 500,
        });
        assert.equal(
          await evaluate(
            tab,
            "document.documentElement.scrollWidth<=innerWidth",
          ),
          true,
          `Gallery fits ${width}`,
        );
      }
      await tab.call("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        tab,
        `document.querySelector('.gallery-open').focus();document.querySelector('.gallery-open').click()`,
      );
      await until(
        () => evaluate(tab, `!!document.querySelector('dialog[open]')`),
        "accessible image preview",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('dialog').contains(document.activeElement)`,
        ),
        true,
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Compare source').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelectorAll('.preview-images img').length===2`,
          ),
        "source side-by-side",
      );
      await tab.call("Page.bringToFront");
      await tab.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await tab.call("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await until(
        () => evaluate(tab, `!document.querySelector('dialog[open]')`),
        "Escape closes preview",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.activeElement.classList.contains('gallery-open')`,
        ),
        true,
        "Focus returns to initiating preview button",
      );
      // User-provided copy is a local derived export with frozen applied text.
      await evaluate(
        tab,
        `document.querySelectorAll('.gallery-open')[6].click()`,
      );
      await until(
        () => evaluate(tab, `!!document.querySelector('dialog[open]')`),
        "campaign preview",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog details')].find(d=>d.querySelector('summary').textContent==='Optional local campaign variants').open=true;(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const inputs=document.querySelectorAll('dialog input:not([type=range]):not([type=checkbox])');set.call(inputs[0],'Approved Brand A');inputs[0].dispatchEvent(new Event('input',{bubbles:true}));set.call(inputs[1],'Approved headline A');inputs[1].dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `![...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Preview my copy').disabled`,
          ),
        "user copy ready",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Preview my copy').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Download local variant'&&!b.disabled)`,
          ),
        "local copy preview",
      );
      await evaluate(
        tab,
        `(()=>{const e=document.querySelectorAll('dialog input:not([type=range]):not([type=checkbox])')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Edited but not applied B');e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      const downloadDir = join(root, "downloads");
      await mkdir(downloadDir);
      await tab.call("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloadDir,
      });
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Download local variant').click()`,
      );
      await until(
        async () =>
          (await readdir(downloadDir)).some((n) => n.endsWith(".zip")),
        "local variant ZIP",
      );
      const variantReader = new ZipReader(
        new Uint8ArrayReader(
          new Uint8Array(
            await readFile(
              join(
                downloadDir,
                (await readdir(downloadDir)).find((n) => n.endsWith(".zip")),
              ),
            ),
          ),
        ),
      );
      try {
        const entries = await variantReader.getEntries(),
          meta = JSON.parse(
            await entries
              .find((e) => e.filename === "variant-information.json")
              .getData(new TextWriter()),
          );
        assert.equal(meta.userProvidedCopy.headline, "Approved headline A");
        assert.equal(meta.userProvidedCopy.brand, "Approved Brand A");
        assert.equal(
          meta.parentOutputSha256,
          saved.items.find((i) => i.style === "billboard").hash,
        );
      } finally {
        await variantReader.close();
      }
      assert.equal(
        await evaluate(tab, `window.__qaRequests.length`),
        8,
        "Local variants do not call the provider",
      );
      await evaluate(
        tab,
        `document.querySelector('dialog button[aria-label="Close preview"]').click()`,
      );
      // A multi-product board pauses after analysis until one essential local choice.
      await evaluate(
        tab,
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload another').click();window.__qaScenario='ambiguous'`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[aria-label="Upload product image"]')`,
          ),
        "new board controls",
      );
      await evaluate(tab, boardScript({ ambiguous: true }));
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelectorAll('.subject-choice').length===2`,
          ),
        "essential subject selection",
      );
      assert.equal(
        await evaluate(tab, `window.__qaRequests.length`),
        9,
        "Only analysis is sent before choosing",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.activeElement.classList.contains('subject-choice')`,
        ),
        true,
        "Choice receives focus",
      );
      await evaluate(
        tab,
        `document.querySelectorAll('.subject-choice')[1].click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `window.__qaRequests.length===16&&!document.querySelector('.auto-upload.processing')`,
          ),
        "selected subject generated and reviewed",
      );
      const selectedEdits = await evaluate(
        tab,
        `window.__qaRequests.slice(9).filter(r=>r.endpoint.endsWith('/edits'))`,
      );
      assert.equal(selectedEdits.length, 6);
      assert.ok(
        selectedEdits.every(
          (r) =>
            r.images.length === 1 &&
            r.images[0].blue > 0 &&
            r.images[0].red === 0 &&
            r.images[0].magenta === 0,
        ),
        "Only selected second product is sent",
      );
      // A single explicit retry uses frozen safe crops, never another source analysis.
      await evaluate(
        tab,
        `window.confirm=()=>true;document.querySelector('.gallery-open').focus();document.querySelector('.gallery-open').click()`,
      );
      await until(
        () => evaluate(tab, `!!document.querySelector('dialog[open]')`),
        "preview for regeneration",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Regenerate this look').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Confirm new paid attempt')`,
          ),
        "explicit retry cost confirmation",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Confirm new paid attempt').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `window.__qaRequests.length===17&&!document.querySelector('dialog button[disabled]')?.textContent.includes('Generating')`,
          ),
        "one image regeneration",
      );
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelector('select[aria-label="Version history"]')?.options.length===2`,
          ),
        "immutable prior version retained",
      );
      assert.equal(
        (await evaluate(tab, `window.__qaRequests`)).filter((r) => r.purpose)
          .length,
        4,
        "Regeneration makes no hidden auxiliary calls",
      );
      await until(
        () =>
          evaluate(
            tab,
            `(()=>{const b=[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Regenerate this look');return b&&!b.disabled})()`,
          ),
        "completed retry ready for explicit next action",
      );
      // Unknown retry keeps the old successful result visible and pauses paid work in this modal.
      await evaluate(
        tab,
        `window.__qaFailPurpose='image';[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Regenerate this look').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Confirm new paid attempt')`,
          ),
        "unknown retry confirmation",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Confirm new paid attempt').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelector('dialog')?.innerText.includes('Billing review needed')`,
          ),
        "unknown retry explained inside modal",
      );
      assert.equal(
        await evaluate(
          tab,
          `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Regenerate this look').disabled`,
        ),
        true,
      );
      assert.equal(
        await evaluate(tab, `!!document.querySelector('.preview-images img')`),
        true,
        "Previous successful output stays available",
      );
      await delay(200);
      assert.equal(
        await evaluate(tab, `window.__qaRequests.length`),
        18,
        "No automatic resend",
      );
      await tab.call("Page.reload");
      await until(
        () =>
          evaluate(
            tab,
            `[...document.querySelectorAll('button')].some(b=>b.textContent==='Upload another')`,
          ),
        "restored compact results",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='Upload another').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `!!document.querySelector('input[name=automatic-mode]')`,
          ),
        "reload mode control",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('input[name=automatic-mode]').checked`,
        ),
        true,
      );
      await evaluate(
        tab,
        `document.querySelectorAll('input[name=automatic-mode]')[1].click()`,
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('.automatic-options input[type=checkbox]').checked`,
        ),
        false,
        "Reload does not restore transmission consent",
      );
      assert.equal(
        await evaluate(
          tab,
          `document.querySelector('input[aria-label="Upload product image"]').disabled`,
        ),
        true,
      );
      // A different valid PNG with the old digest cannot be resealed through local variants.
      await evaluate(
        tab,
        `(async()=>{const c=document.createElement('canvas');c.width=c.height=1024;c.getContext('2d').fillRect(0,0,1024,1024);const blob=await new Promise(r=>c.toBlob(r,'image/png')),q=indexedDB.open('image-studio-automatic',3),db=await new Promise(r=>q.onsuccess=()=>r(q.result));try{await new Promise((resolve,reject)=>{const tx=db.transaction('runs','readwrite'),store=tx.objectStore('runs'),r=store.getAll();r.onsuccess=()=>{const run=r.result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];run.items.find(i=>i.style==='billboard').output=blob;store.put(run)};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}finally{db.close()}window.__unexpectedProvider=0;const original=window.fetch;window.fetch=(url,init)=>{if(String(url).startsWith('https://api.openai.com/')){window.__unexpectedProvider++;return Promise.reject(Error('No external request authorized in local variant test'))}return original(url,init)};location.hash='#/images'})()`,
      );
      await until(
        () => evaluate(tab, `!!document.querySelector('.library-card')`),
        "tampered history library",
      );
      await evaluate(tab, `document.querySelector('.library-card').click()`);
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelectorAll('.gallery-open').length===7`,
          ),
        "tampered history reopened",
      );
      await evaluate(
        tab,
        `document.querySelectorAll('.gallery-open')[6].click()`,
      );
      await until(
        () => evaluate(tab, `!!document.querySelector('dialog[open]')`),
        "tampered campaign preview",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog details')].find(d=>d.querySelector('summary').textContent==='Optional local campaign variants').open=true;(()=>{const e=document.querySelectorAll('dialog input:not([type=range]):not([type=checkbox])')[0];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'User copy');e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `![...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Preview my copy').disabled`,
          ),
        "tampered copy action",
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Preview my copy').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `document.querySelector('dialog')?.innerText.includes('failed its integrity check')`,
          ),
        "copy rejects stale base hash",
      );
      assert.equal(
        await evaluate(
          tab,
          `[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Download local variant')`,
        ),
        false,
      );
      await evaluate(
        tab,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Billboard preview').click()`,
      );
      await until(
        () =>
          evaluate(
            tab,
            `![...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Billboard preview').disabled`,
          ),
        "billboard integrity rejection settled",
      );
      assert.equal(
        await evaluate(
          tab,
          `[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Download local variant')`,
        ),
        false,
      );
      assert.equal(await evaluate(tab, `window.__unexpectedProvider`), 0);
    } catch (error) {
      if (tab)
        console.error(
          "Safe fixture diagnostic:",
          await evaluate(
            tab,
            `({results:document.querySelector('.auto-results')?.innerText,choices:document.querySelector('.subject-choices')?.innerText,requests:window.__qaRequests?.map(r=>({purpose:r.purpose,endpoint:r.endpoint,images:r.images.length}))})`,
          ).catch(() => null),
        );
      console.error("Pages journey failure:", error);
      throw error;
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
