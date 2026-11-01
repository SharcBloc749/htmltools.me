import { normalizePath } from './util.mjs';

const MAX_PAGES = 30;
const MAX_SITEMAP_FILES = 8;
const MAX_SITEMAP_URLS = 500;
const MAX_SITEMAP_BYTES = 200_000;
const MAX_PAGE_BYTES = 320_000;
const MAX_TEXT_CHARS = 7_000;
const PRIVATE_PATH = /\/(?:admin|dashboard|login|logout|account|auth|api|private|checkout|cart)(?:\/|$)/i;
const FILE_PATH = /\.(?:pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|mp4|mp3|wav|woff2?|ttf|css|js|json|xml|txt|map|exe|dmg)(?:$|\?)/i;
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', ndash: '–', mdash: '—', hellip: '…' };

function decodeEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
    }
    return ENTITY[entity.toLowerCase()] || ' ';
  });
}

function attr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((value) => value !== undefined) || '';
}

function plainText(html) {
  return decodeEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|object|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|header|footer|li|h[1-6]|tr|td|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isCrawlablePath(path) {
  const normalized = normalizePath(path);
  return Boolean(normalized && !PRIVATE_PATH.test(normalized) && !FILE_PATH.test(normalized));
}

function hostUrl(host, path = '/') { return new URL(path, `https://${host}`); }
function sameVerifiedHost(left, right) {
  const canonical = (host) => String(host).toLowerCase().replace(/^www\./, '');
  return canonical(left) === canonical(right);
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw Object.assign(new Error('The page exceeded the per-response crawl limit.'), { code: 'page_too_large' });
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw Object.assign(new Error('The page exceeded the per-response crawl limit.'), { code: 'page_too_large' }); }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch { /* ignored */ } }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

async function fetchSameHost(url, host, maxBytes, fetchImpl = fetch) {
  let current = new URL(url);
  if (current.protocol !== 'https:' || current.port || !sameVerifiedHost(current.hostname, host)) return null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response;
    try {
      response = await fetchImpl(current.href, {
        redirect: 'manual',
        headers: { 'user-agent': 'SiloAI-SiteIndexer/1.0 (+https://htmltools.me/SiloAI/)', accept: 'text/html,application/xml,text/xml;q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(7_000),
      });
    } catch { return null; }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || next.port || !sameVerifiedHost(next.hostname, host)) return null;
      current = next;
      continue;
    }
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!/(text\/html|application\/xhtml\+xml|application\/xml|text\/xml|text\/plain)/i.test(type)) return null;
    try {
      const body = await readLimited(response, maxBytes);
      return { url: current.href, body, type };
    } catch (failure) {
      if (failure?.code === 'page_too_large') return { url: current.href, body: '', type, tooLarge: true };
      throw failure;
    }
  }
  return null;
}

async function loadRobotsPolicy(host) {
  const response = await fetchSameHost(hostUrl(host, '/robots.txt'), host, 80_000);
  if (response?.tooLarge) throw Object.assign(new Error('robots.txt exceeds the 80 KB safety limit, so its crawl rules cannot be checked.'), { code: 'robots_too_large' });
  if (!response) return { disallow: [], allow: [], sitemaps: [] };
  let active = false;
  const disallow = [];
  const allow = [];
  const sitemaps = [];
  for (const raw of response.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const sitemapMatch = /^sitemap\s*:\s*(.+)$/i.exec(line);
    if (sitemapMatch) { sitemaps.push(sitemapMatch[1].trim()); continue; }
    const match = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    if (key === 'user-agent') active = value === '*' || /siloai/i.test(value);
    else if (active && value) (key === 'allow' ? allow : disallow).push(value);
  }
  return { disallow, allow, sitemaps };
}

function robotsAllows(policy, path) {
  const blocked = policy.disallow.filter((rule) => path.startsWith(rule)).sort((a, b) => b.length - a.length)[0];
  const permitted = policy.allow.filter((rule) => path.startsWith(rule)).sort((a, b) => b.length - a.length)[0];
  return !blocked || Boolean(permitted && permitted.length >= blocked.length);
}

function cleanTitle(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function isPlaceholderTitle(value) {
  return /^(?:redirect(?:ing)?(?:\.\.\.)?|please wait|loading(?:\.\.\.)?|untitled)$/i.test(String(value || '').trim());
}

function parsePage(url, html) {
  const pageUrl = new URL(url);
  const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
  const descriptionTag = metaTags.find((tag) => /^(?:description|og:description)$/i.test(attr(tag, 'name') || attr(tag, 'property'))) || '';
  const description = decodeEntities(attr(descriptionTag, 'content')).replace(/\s+/g, ' ').trim().slice(0, 320);
  const headingText = [...html.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]\s*>/gi)]
    .slice(0, 16).map((match) => plainText(match[1]).slice(0, 140)).filter(Boolean);
  const rawTitle = cleanTitle(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] || '');
  const metaTitleTag = metaTags.find((tag) => /^(?:og:title|twitter:title|title)$/i.test(attr(tag, 'property') || attr(tag, 'name'))) || '';
  const metaTitle = cleanTitle(attr(metaTitleTag, 'content'));
  const fallbackHeading = headingText.find((value) => !isPlaceholderTitle(value)) || headingText[0] || '';
  const title = [rawTitle, metaTitle, fallbackHeading].find((value) => value && !isPlaceholderTitle(value))
    || rawTitle || metaTitle || fallbackHeading || pageUrl.pathname || 'Home';
  const redirectPlaceholder = Boolean(rawTitle && isPlaceholderTitle(rawTitle)
    && ![metaTitle, fallbackHeading].some((value) => value && !isPlaceholderTitle(value)));
  const linkPaths = new Set();
  const addInternalPath = (href) => {
    if (!href || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) return;
    try {
      const target = new URL(href, pageUrl);
      if (target.protocol !== 'https:' || target.port || target.hostname !== pageUrl.hostname) return;
      target.hash = '';
      target.search = '';
      const path = target.pathname.replace(/\/{2,}/g, '/');
      if (isCrawlablePath(path)) linkPaths.add(path);
    } catch { /* ignore malformed links and redirect targets */ }
  };
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) addInternalPath(attr(match[0], 'href'));

  // Treat declared redirects as crawl hints without executing any site script.
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (attr(match[0], 'http-equiv').toLowerCase() !== 'refresh') continue;
    const content = attr(match[0], 'content');
    const target = /(?:^|;)\s*url\s*=\s*["']?([^"';\s]+)["']?/i.exec(content)?.[1];
    if (target) addInternalPath(target);
  }
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    for (const redirect of script[1].matchAll(/(?:window\s*\.\s*)?location(?:\s*\.\s*href)?\s*(?:=\s*|\.replace\s*\(\s*|\.assign\s*\(\s*)(["'])(.*?)\1/gi)) {
      addInternalPath(redirect[2]);
    }
  }
  const text = plainText(html).slice(0, MAX_TEXT_CHARS);
  return { url: pageUrl.href, path: pageUrl.pathname, title, description, headings: headingText, links: [...linkPaths].slice(0, 80), text, redirectPlaceholder };
}

function ownerSeedPaths(paths) {
  const seeds = [];
  for (const raw of (Array.isArray(paths) ? paths : []).slice(0, MAX_PAGES * 2)) {
    if (typeof raw !== 'string') continue;
    let candidate = raw.trim();
    if (candidate.endsWith('/**')) candidate = candidate.slice(0, -3) || '/';
    const path = normalizePath(candidate);
    if (path && isCrawlablePath(path)) seeds.push(path);
  }
  return [...new Set(seeds)].slice(0, MAX_PAGES - 1);
}

function isRedirectPlaceholder(page) {
  const title = String(page?.title || '').trim();
  const text = String(page?.text || '').trim();
  return page?.redirectPlaceholder === true
    || /^(?:redirect(?:ing)?(?:\.\.\.)?|please wait|loading(?:\.\.\.)?|untitled)$/i.test(title)
    || (text.length < 500 && /redirecting\.\.\.|if you are not redirected|redirecting to/i.test(text));
}

function safeSitemapUrl(value, host, robots) {
  try {
    const target = new URL(value, `https://${host}/`);
    if (target.protocol !== 'https:' || target.port || !sameVerifiedHost(target.hostname, host) || !robotsAllows(robots, target.pathname)) return null;
    target.hash = '';
    return target.href;
  } catch { return null; }
}

async function sitemapPaths(host, robots) {
  const sitemapQueue = [hostUrl(host, '/sitemap.xml').href, ...(robots.sitemaps || [])]
    .map((value) => safeSitemapUrl(value, host, robots)).filter(Boolean);
  const seenSitemaps = new Set();
  const pagePaths = new Set();
  while (sitemapQueue.length && seenSitemaps.size < MAX_SITEMAP_FILES && pagePaths.size < MAX_SITEMAP_URLS) {
    const sitemapUrl = sitemapQueue.shift();
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const result = await fetchSameHost(sitemapUrl, host, MAX_SITEMAP_BYTES);
    if (!result || result.tooLarge || !/xml/i.test(result.type)) continue;
    if (/<(?:[\w.-]+:)?sitemapindex\b/i.test(result.body)) {
      for (const match of result.body.matchAll(/<(?:[\w.-]+:)?loc\b[^>]*>\s*([^<]+)\s*<\/(?:[\w.-]+:)?loc\s*>/gi)) {
        const child = safeSitemapUrl(decodeEntities(match[1].trim()), host, robots);
        if (child && !seenSitemaps.has(child) && !sitemapQueue.includes(child)) sitemapQueue.push(child);
      }
      continue;
    }
    for (const match of result.body.matchAll(/<(?:[\w.-]+:)?loc\b[^>]*>\s*([^<]+)\s*<\/(?:[\w.-]+:)?loc\s*>/gi)) {
      try {
        const target = new URL(decodeEntities(match[1].trim()));
        if (target.protocol === 'https:' && !target.port && sameVerifiedHost(target.hostname, host) && isCrawlablePath(target.pathname) && robotsAllows(robots, target.pathname)) {
          pagePaths.add(target.pathname);
        }
      } catch { /* malformed sitemap entry */ }
      if (pagePaths.size >= MAX_SITEMAP_URLS) break;
    }
  }
  return [...pagePaths];
}

/**
 * Confirms the site owner published the verification token.
 *
 * Owners can either drop the `.well-known` text file in place, or paste the URL of
 * any page on their own domain that contains the exact token somewhere in its body.
 * The token is a secret per site, so a page holding it is proof of control.
 */
export async function verifyDomainFile(host, token, options = {}) {
  const settings = typeof options === 'function' ? { fetchImpl: options } : (options || {});
  const fetchImpl = settings.fetchImpl || fetch;
  const path = typeof settings.path === 'string' && settings.path.startsWith('/') ? settings.path : '/.well-known/siloai-verification.txt';
  const expected = `siloai-verification=${token}`;
  const response = await fetchSameHost(hostUrl(host, path), host, 64_000, fetchImpl);
  if (!response || response.tooLarge || !response.body) return false;
  return response.body.includes(expected);
}

export async function crawlSite(host, priorPages = [], ownerPaths = []) {
  const robots = await loadRobotsPolicy(host);
  if (!robotsAllows(robots, '/')) throw Object.assign(new Error('The site robots.txt disallows SiloAI from crawling its homepage.'), { code: 'robots_disallow' });
  const sitemap = await sitemapPaths(host, robots);
  const old = new Map((priorPages || []).map((page) => [page.path, page]));
  const seeds = ownerSeedPaths(ownerPaths);
  const queue = [{ path: '/', depth: 0 }, ...seeds.map((path) => ({ path, depth: 1 })), ...sitemap.map((path) => ({ path, depth: 1 }))];
  const queued = new Set();
  const pages = [];
  const oversizedPaths = new Set();
  while (queue.length && pages.length < MAX_PAGES) {
    const batch = [];
    while (queue.length && batch.length < 4 && pages.length + batch.length < MAX_PAGES) {
      const item = queue.shift();
      if (queued.has(item.path)) continue;
      queued.add(item.path);
      if (!isCrawlablePath(item.path) || !robotsAllows(robots, item.path)) continue;
      batch.push(item);
    }
    if (!batch.length) continue;
    const results = await Promise.all(batch.map(async (item) => {
      const result = await fetchSameHost(hostUrl(host, item.path), host, MAX_PAGE_BYTES);
      if (result?.tooLarge) return { tooLarge: true, path: item.path };
      if (!result || !/html/i.test(result.type)) return null;
      const page = parsePage(result.url, result.body);
      if (item.depth < 3) for (const path of page.links) if (!queued.has(path)) queue.push({ path, depth: item.depth + 1 });
      return page;
    }));
    for (const page of results) {
      if (page?.tooLarge) oversizedPaths.add(page.path);
      else if (page && !pages.some((existing) => existing.path === page.path)) pages.push(page);
    }
  }
  if (!pages.length && oversizedPaths.size) {
    throw Object.assign(new Error('All reachable public HTML pages exceeded the 320 KB per-page limit. Reduce page size or exclude oversized routes; SiloAI will continue indexing other pages when they are available.'), { code: 'all_pages_too_large' });
  }
  if (!pages.length) throw Object.assign(new Error('SiloAI could not read any public HTML pages on this site.'), { code: 'crawl_empty' });
  const home = pages.find((page) => page.path === '/') || pages[0];
  const profilePage = home && !isRedirectPlaceholder(home) ? home : pages.find((page) => !isRedirectPlaceholder(page)) || home;
  return {
    pages,
    profile: { title: profilePage.title, description: profilePage.description || profilePage.headings.slice(0, 3).join(' · ') || profilePage.text.slice(0, 240) },
    crawledAt: Date.now(),
    skippedLargePages: oversizedPaths.size,
    skippedLargePaths: [...oversizedPaths].slice(0, 10),
    changedPages: pages.filter((page) => JSON.stringify(old.get(page.path) || null) !== JSON.stringify(page)).length + [...old.keys()].filter((path) => !pages.some((page) => page.path === path)).length,
  };
}

export function relevantPages(site, query, currentPath = '/', currentTitle = '') {
  const terms = String(query).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const current = normalizePath(currentPath) || '/';
  return [...(site.pages || [])].filter((page) => !isRedirectPlaceholder(page)).map((page) => {
    const haystack = `${page.path} ${page.title} ${page.description} ${(page.headings || []).join(' ')} ${page.text}`.toLowerCase();
    let score = page.path === current ? 100 : (current.startsWith(page.path.replace(/\/$/, '') + '/') ? 18 : 0);
    const titleTerms = String(currentTitle).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    for (const term of titleTerms) if (haystack.includes(term)) score += 14;
    for (const term of terms) {
      let index = haystack.indexOf(term);
      let hits = 0;
      while (index >= 0 && hits < 4) { score += index < 200 ? 2 : 1; hits++; index = haystack.indexOf(term, index + term.length); }
    }
    return { page, score };
  }).sort((a, b) => b.score - a.score).slice(0, 3).map(({ page }) => page);
}
