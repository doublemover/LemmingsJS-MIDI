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
  const $ = load(html, { withStartIndices: true, withEndIndices: true });
  const snippets = [];

  $('script').each((i, elem) => {
    const src = $(elem).attr('src');
    if (src) return; // external script
    const code = $(elem).html() || '';
    const loc = {};
    if (typeof elem.startIndex === 'number') loc.start = elem.startIndex;
    if (typeof elem.endIndex === 'number') loc.end = elem.endIndex;
    snippets.push({ code, loc, type: 'script' });
  });

  $('*').each((i, elem) => {
    for (const [name, value] of Object.entries(elem.attribs)) {
      if (/^on[a-z]+/i.test(name)) {
        const loc = {};
        if (typeof elem.startIndex === 'number') loc.start = elem.startIndex;
        if (typeof elem.endIndex === 'number') loc.end = elem.endIndex;
        snippets.push({ code: value, loc, type: 'handler', attr: name });
      }
    }
  });

  return snippets;
}
