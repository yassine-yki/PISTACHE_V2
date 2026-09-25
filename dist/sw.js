const CACHE="pistache-shell-7ce3b2edf7e3afe8";
const FILES=["/index.html","/favicon.svg","/vendor/dxf-parser.js","/projects/mixed-use/r2/a2.dxf","/assets/index-BjX7Wsc4.css","/assets/index-ClAQkXvM.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pistache-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const path=url.pathname==='/'?'/index.html':url.pathname;
  if(!FILES.includes(path))return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);
    if(path==='/index.html'){try{const response=await fetch(event.request);if(response.ok)await cache.put('/index.html',response.clone());return response;}catch{ return (await cache.match('/index.html'))||Response.error(); }}
    const cached=await cache.match(path);return cached||fetch(event.request);
  })());
});
