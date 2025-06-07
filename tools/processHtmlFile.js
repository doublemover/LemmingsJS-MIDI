import fs from 'fs';
import path from 'path';
import { load } from 'cheerio';
import { pathToFileURL } from 'url';

/**
 * Parse an HTML file and return JavaScript snippets found in
 * <script> tags or inline event handler attributes.
 * Each snippet includes the code and start/end indices when available.
 * @param {string} filePath
 * @returns {Array<{code:string,loc?:{start?:number,end?:number},type:string,attr?:string}>}
 */
export function processHtmlFile(filePath, options = {}) {
  const html = fs.readFileSync(filePath, 'utf8');
  const dir = path.dirname(filePath);
  const { rewritePaths = false, inline = false } = options;
  const $ = load(html, { sourceCodeLocationInfo: true });
  const snippets = [];

  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src) return; // ignore external scripts for snippet extraction

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
    function isRelative(p) {
      return typeof p === 'string' && !/^(?:[a-z]+:)?\/\//i.test(p);
    }

    $('*[src], link[href]').each((i, elem) => {
      const attr = elem.attribs.src ? 'src' : 'href';
      const val = $(elem).attr(attr);
      if (!isRelative(val)) return;
      const abs = path.resolve(dir, val);
      if (inline && elem.name === 'script') {
        const code = fs.readFileSync(abs, 'utf8');
        $(elem).removeAttr('src');
        $(elem).text(code);
      } else if (inline && elem.name === 'link' && $(elem).attr('rel') === 'stylesheet') {
        const css = fs.readFileSync(abs, 'utf8');
        $(elem).replaceWith(`<style>${css}</style>`);
      } else {
        $(elem).attr(attr, pathToFileURL(abs).href);
      }
    });
  }

  const output = $.html();
  if (rewritePaths || inline) return { snippets, html: output };
  return snippets;
}
