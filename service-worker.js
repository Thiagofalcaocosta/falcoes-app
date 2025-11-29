self.addEventListener("install", e => {
  console.log("Service Worker instalado");
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  console.log("Service Worker ativado");
  self.clients.claim();
});

self.addEventListener("fetch", () => {});
