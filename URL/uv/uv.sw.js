class UVServiceWorker {
    constructor(config = self.__uv$config) {
        this.config = config;
    }

    async fetch(event) {
        return fetch(event.request);
    }
}

self.UVServiceWorker = UVServiceWorker;
