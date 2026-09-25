import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export async function writeOfflineWorker(directory) {
  const files=["index.html","favicon.svg","vendor/dxf-parser.js","projects/mixed-use/r2/a2.dxf"];
  for(const file of await readdir(resolve(directory,"assets"))) if(/\.(js|css)$/.test(file)) files.push("assets/"+file);
  const digest=createHash("sha256");
  for(const file of files) digest.update(await readFile(resolve(directory,file)));
  const cache="pistache-shell-"+digest.digest("hex").slice(0,16);
  const worker=[
    "const CACHE="+JSON.stringify(cache)+";",
    "const FILES="+JSON.stringify(files.map(f=>"/"+f))+";",
    "self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));",
    "self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pistache-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));",
    "self.addEventListener('fetch',event=>{",
    "  const url=new URL(event.request.url);",
    "  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;",
    "  const path=url.pathname==='/'?'/index.html':url.pathname;",
    "  if(!FILES.includes(path))return;",
    "  event.respondWith((async()=>{const cache=await caches.open(CACHE);",
    "    if(path==='/index.html'){try{const response=await fetch(event.request);if(response.ok)await cache.put('/index.html',response.clone());return response;}catch{ return (await cache.match('/index.html'))||Response.error(); }}",
    "    const cached=await cache.match(path);return cached||fetch(event.request);",
    "  })());",
    "});",""
  ].join("\n");
  await writeFile(resolve(directory,"sw.js"),worker);
}
