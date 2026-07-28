importScripts('/URL/uv/uv.bundle.js');
importScripts('/URL/uv/uv.config.js');
importScripts('/URL/uv/uv.sw.js');

const sw = new UVServiceWorker();

self.addEventListener('fetch', (event) => {
  if (event.request.url.startsWith(location.origin + self.__uv$config.prefix)) {
    event.respondWith(sw.fetch(event));
  }
});
