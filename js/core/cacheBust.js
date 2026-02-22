const CACHE_BUST_PARAM = 'rev';
const ALT_CACHE_BUST_PARAMS = Object.freeze(['cacheBust', 'cb']);
const CACHE_BUST_PATTERN = /[^a-zA-Z0-9._-]/g;
const MAX_CACHE_BUST_LENGTH = 64;

const sanitizeCacheBust = (value) => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(CACHE_BUST_PATTERN, '').slice(0, MAX_CACHE_BUST_LENGTH);
  return normalized || null;
};

const readCacheBustFromSearch = (search = '') => {
  if (typeof URLSearchParams === 'undefined') return null;
  const params = new URLSearchParams(search || '');
  const direct = sanitizeCacheBust(params.get(CACHE_BUST_PARAM));
  if (direct) return direct;
  for (let i = 0; i < ALT_CACHE_BUST_PARAMS.length; i += 1) {
    const value = sanitizeCacheBust(params.get(ALT_CACHE_BUST_PARAMS[i]));
    if (value) return value;
  }
  return null;
};

const resolveRuntimeRevision = ({
  revision = null,
  location = globalThis.location,
  document = globalThis.document,
  globalValue = globalThis.__LEMMINGS_RUNTIME_REVISION__
} = {}) => {
  const explicit = sanitizeCacheBust(revision);
  if (explicit) return explicit;
  const query = readCacheBustFromSearch(location?.search || '');
  if (query) return query;
  const globalRevision = sanitizeCacheBust(globalValue);
  if (globalRevision) return globalRevision;
  const metaRevision = sanitizeCacheBust(
    document?.querySelector?.('meta[name="lemmings-revision"]')?.getAttribute?.('content')
  );
  if (metaRevision) return metaRevision;
  return null;
};

const appendRevisionParam = (url, revision, paramName = CACHE_BUST_PARAM) => {
  if (typeof url !== 'string' || !url) return url;
  const token = sanitizeCacheBust(revision);
  if (!token) return url;
  const param = sanitizeCacheBust(paramName) || CACHE_BUST_PARAM;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const encoded = encodeURIComponent(token);
  const directPattern = new RegExp(`([?&])${param}=([^&#]*)`);
  if (directPattern.test(base)) {
    return `${base.replace(directPattern, `$1${param}=${encoded}`)}${hash}`;
  }
  const delimiter = base.includes('?') ? '&' : '?';
  return `${base}${delimiter}${param}=${encoded}${hash}`;
};

export {
  CACHE_BUST_PARAM,
  appendRevisionParam,
  readCacheBustFromSearch,
  resolveRuntimeRevision,
  sanitizeCacheBust
};
