// Builds the 3D viewer that meshy_view_model shows (an MCP App) into one
// self-contained page, dist/viewer/model-viewer.html: three.js and the viewer
// code are inlined because an app frame may not load scripts from anywhere.
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const bundle = await esbuild.build({
  entryPoints: [path.join(root, "viewer/model-viewer.js")],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2022",
  legalComments: "none",
  write: false,
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = fs.readFileSync(path.join(root, "viewer/model-viewer.html"), "utf8");
const marker = "<!-- viewer script -->";
if (!template.includes(marker)) throw new Error(`viewer/model-viewer.html lost its "${marker}" marker`);
const html = template.replace(marker, () => `<script>${js}</script>`);

const out = path.join(root, "dist/viewer/model-viewer.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.error(`viewer: ${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
