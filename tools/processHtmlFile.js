import fs from 'fs';
import { load } from 'cheerio';

/**
 * Parse an HTML file and return JavaScript snippets found in
 * <script> tags or inline event handler attributes.
 * Each snippet includes the code and start/end indices when available.
 * @param {string} filePath
 * @returns {Array<{code:string,loc?:{start?:number,end?:number},type:string,attr?:string}>}
 */
export function processHtmlFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const $ = load(html, { sourceCodeLocationInfo: true });
  const snippets = [];

  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src) return; // ignore external scripts

    const code = $(elem).html() || '';
    const loc = {};
    const info = elem.sourceCodeLocation;
    if (info) {
      loc.start = info.startTag.endOffset;
      loc.end = info.endTag.startOffset;
    }
    snippets.push({ code, loc, type: 'script' });
  });

  $('*').each((i, elem) => {
    const attribs = elem.attribs || {};
    for (const [name, value] of Object.entries(attribs)) {
      if (/^on[a-z]+/i.test(name)) {
        const loc = {};
        const info = elem.sourceCodeLocation?.attrs?.[name];
        if (info) {
          loc.start = info.startOffset;
          loc.end = info.endOffset;
        }
        snippets.push({ code: value, loc, type: 'handler', attr: name });
      }
    }
  });

  return snippets;
}
