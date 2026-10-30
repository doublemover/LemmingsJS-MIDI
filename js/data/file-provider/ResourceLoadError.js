export class ResourceLoadError extends Error {
  constructor(kind, requestedUrl, { status = null, cause = null, operationId = null } = {}) {
    const description = status != null ? `HTTP ${status}` : kind === 'not-found' ? 'not found' : kind;
    super(`error load file (${description})`, cause ? { cause } : undefined);
    this.name = 'ResourceLoadError';
    this.kind = kind;
    this.requestedUrl = requestedUrl;
    this.status = status;
    this.retryable = kind === 'network' || kind === 'timeout' || kind === 'rate-limit' || kind === 'server' || kind === 'busy';
    this.operationId = operationId;
  }
}

export const resourceKindFromStatus = status => {
  if (status === 404 || status === 410) return 'not-found';
  if (status === 401 || status === 403) return 'denied';
  if (status === 429) return 'rate-limit';
  if (status >= 500 && status <= 599) return 'server';
  return status === 0 ? 'network' : 'http';
};

export const isMissingResourceError = error => error?.kind === 'not-found' || error?.code === 'ENOENT';
