importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('https://cdn.jsdelivr.net/npm/@titaniumnetwork-dev/ultraviolet@3.2.10/dist/uv.sw.js');

const sw = new UVServiceWorker();

self.addEventListener('fetch', (event) => {
  if (event.request.url.startsWith(location.origin + location.pathname.replace('sw.js', '') + self.__uv$config.prefix)) {
    event.respondWith(sw.fetch(event));
  }
});
