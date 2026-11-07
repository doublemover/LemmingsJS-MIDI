import { expect } from 'chai';
import { surveySourceImports } from '../js/app/procgen/survey/SurveySourceImports.js';

describe('literal survey source imports', () => {
  it('excludes JSDoc type imports, ordinary comments and quoted examples', () => {
    const source = `/** @param {import('./Types.js').Options} options */
// import './line.js';
/* export {x} from './block.js'; */
const example = "import('./quoted.js')";
import { actual } from './actual.js';`;
    expect(surveySourceImports(source)).to.deep.equal(['./actual.js']);
  });
  it('retains static, side-effect, re-export and literal dynamic edges across comments', () => {
    expect(surveySourceImports('import \'./side.js\'; import {x} /* comment */ from \'./named.js\'; export * from \'./export.js\'; const load = () => import(/* comment */ \'./lazy.js\');'))
      .to.deep.equal(['./side.js', './named.js', './export.js', './lazy.js']);
  });
  it('ignores properties, import metadata, bare packages and unrelated strings', () => {
    expect(surveySourceImports('import x from \'package\'; export const example = \'./data.js\'; const from = \'./other.js\'; object.import(\'./method.js\'); import.meta.url;'))
      .to.deep.equal([]);
  });
  it('refuses escaped specifiers instead of silently resolving another source', () => {
    expect(() => surveySourceImports('import \'./escaped\\x2ejs\';')).to.throw('Escaped survey module');
  });
  it('refuses template-contained loaders outside the explicit literal contract', () => {
    expect(() => surveySourceImports('const value = `${import("./nested.js")}`;')).to.throw('Template-contained');
    expect(surveySourceImports('export const text = `How to import sounds`;')).to.deep.equal([]);
  });
});
