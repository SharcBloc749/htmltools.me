self.__uv$config = {
  prefix: '/URL/uv/service/',
  bare: 'wss://wisp.mercurywork.shop/',
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: '/URL/uv/uv.handler.js',
  client: '/URL/uv/uv.client.js',
  bundle: '/URL/uv/uv.bundle.js',
  config: '/URL/uv/uv.config.js',
  sw: '/URL/uv/uv.sw.js',
};
