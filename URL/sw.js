importScripts('/URL/uv/uv.bundle.js');
importScripts('/URL/uv/uv.config.js?v=5');

// Load compiled UV service worker core directly from CDN
importScripts('https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@3.2.10/dist/uv.sw.js');

const sw = new UVServiceWorker();

self.addEventListener('fetch', (event) => {
  if (event.request.url.startsWith(location.origin + self.__uv$config.prefix)) {
    event.respondWith(sw.fetch(event));
  }
});
