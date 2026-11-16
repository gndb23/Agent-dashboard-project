// Builds public/agent-ops.ico (used by the Windows shortcuts) from public/icon.svg.
// Dev-only helper: needs Playwright's Chromium. Run: node scripts/make-icon.cjs
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const svg = fs.readFileSync(path.join(__dirname, "..", "public", "icon.svg"), "utf8");
  const b = await chromium.launch();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${s}" height="${s}" `)}</body></html>`);
    pngs.push(await p.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } }));
    await p.close();
  }
  await b.close();
  // ICO container with PNG-compressed images (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  const out = path.join(__dirname, "..", "public", "agent-ops.ico");
  fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
  console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
})();
