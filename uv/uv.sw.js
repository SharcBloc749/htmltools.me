importScripts('/uv/uv.bundle.js');
importScripts('/uv/uv.config.js');
importScripts('/uv/uv.handler.js');

const sw = new UVServiceWorker();

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    if (event.request.url.startsWith(location.origin + self.__uv$config.prefix)) {
        event.respondWith(sw.fetch(event));
    }
});
