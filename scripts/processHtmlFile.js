import fs from 'fs';
import path from 'path';
import { load } from 'cheerio';
import { pathToFileURL } from 'url';

/**
 * Parse an HTML file and extract JavaScript snippets from inline `<script>`
 * tags and inline event-handler attributes (`onclick`, `onchange`, ...).
 *
 * Behavior flags:
 * - `rewritePaths`: rewrites relative `src`/`href` values to `file://` URLs.
 * - `inline`: inlines relative script/style assets into the HTML output.
 * - `includeExternalScripts`: adds discovered relative script entrypoints to
 *   `entryScripts` for follow-up scanning by callers.
 *
 * Return shape:
 * - default: `snippets[]`
 * - with `includeExternalScripts`: `{ snippets, entryScripts }`
 * - with `rewritePaths` or `inline`: `{ snippets, html, entryScripts }`
 *
 * @param {string} filePath
 * @param {{
 *   rewritePaths?: boolean,
 *   inline?: boolean,
 *   includeExternalScripts?: boolean
 * }} [options]
 * @returns {Array<{code:string,loc?:{start?:number,end?:number},type:string,attr?:string}> | {
 *   snippets: Array<{code:string,loc?:{start?:number,end?:number},type:string,attr?:string}>,
 *   html?: string,
 *   entryScripts: string[]
 * }}
 */
export function processHtmlFile(filePath, options = {}) {
  const html = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const { rewritePaths = false, inline = false, includeExternalScripts = false } = options;
  const $ = load(html, { sourceCodeLocationInfo: true });
  const snippets = [];
  const entryScripts = [];
  const entryScriptSet = new Set();
  const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

  function splitAssetReference(value) {
    const raw = String(value || '').trim();
    if (!raw) return { pathPart: '', suffix: '' };
    const markerIndex = raw.search(/[?#]/);
    if (markerIndex < 0) {
      return { pathPart: raw, suffix: '' };
    }
    return {
      pathPart: raw.slice(0, markerIndex),
      suffix: raw.slice(markerIndex)
    };
  }

  function isRelative(p) {
    if (typeof p !== 'string') return false;
    const { pathPart } = splitAssetReference(p);
    if (!pathPart) return false;
    if (pathPart.startsWith('//')) return false;
    if (URI_SCHEME_RE.test(pathPart)) return false;
    if (path.isAbsolute(pathPart)) return false;
    return true;
  }

  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src) {
      if (includeExternalScripts && isRelative(src)) {
        const { pathPart } = splitAssetReference(src);
        if (pathPart) {
          const resolved = path.resolve(dir, pathPart);
          if (!entryScriptSet.has(resolved)) {
            entryScriptSet.add(resolved);
            entryScripts.push(resolved);
          }
        }
      }
      return;
    }

    const code = $(elem).html() || '';
    const loc = {};
    const sourceInfo = elem.sourceCodeLocation;
    if (sourceInfo) {
      loc.start = sourceInfo.startTag.endOffset;
      loc.end = sourceInfo.endTag.startOffset;
    }
    snippets.push({ code, loc, type: 'script' });
  });

  $('*').each((i, elem) => {
    const attribs = elem.attribs || {};
    for (const [name, value] of Object.entries(attribs)) {
      if (/^on[a-z]+/i.test(name)) {
        const loc = {};
        const sourceInfo = elem.sourceCodeLocation?.attrs?.[name];
        if (sourceInfo) {
          loc.start = sourceInfo.startOffset;
          loc.end = sourceInfo.endOffset;
        }
        snippets.push({ code: value, loc, type: 'handler', attr: name });
      }
    }
  });

  if (rewritePaths || inline) {
    $('*[src], link[href]').each((i, elem) => {
      const attr = elem.attribs.src ? 'src' : 'href';
      const val = $(elem).attr(attr);
      if (!isRelative(val)) return;
      const { pathPart, suffix } = splitAssetReference(val);
      if (!pathPart) return;
      const abs = path.resolve(dir, pathPart);
      if (inline && elem.name === 'script') {
        const code = fs.readFileSync(abs, 'utf8');
        $(elem).removeAttr('src');
        $(elem).text(code);
      } else if (inline && elem.name === 'link' && $(elem).attr('rel') === 'stylesheet') {
        const css = fs.readFileSync(abs, 'utf8');
        $(elem).replaceWith(`<style>${css}</style>`);
      } else {
        $(elem).attr(attr, `${pathToFileURL(abs).href}${suffix}`);
      }
    });
  }

  const output = $.html();
  if (rewritePaths || inline) return { snippets, html: output, entryScripts };
  if (includeExternalScripts) return { snippets, entryScripts };
  return snippets;
}
