import { expect } from 'chai';
import { pathToFileURL } from 'url';

function decodeBase64(b64) {
  const binary = atob(b64.trim());
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('squooshhqx resize', function () {
  let resize;

  before(async function () {
    const modUrl = pathToFileURL('js/vendor/hqx/squooshhqx.js').href + `?t=${Date.now()}`;
    const bgUrl = pathToFileURL('js/vendor/hqx/squooshhqx_bg.js').href + `?t=${Date.now()}`;
    const mod = await import(modUrl);
    const b64 = (await import(bgUrl)).default;
    mod.initSync(decodeBase64(b64));
    resize = mod.resize;
  });

  const INPUT = Uint32Array.from([1, 2, 3, 4]);
  const EXP_2X = [1,1,1,2,1,1,2,2,2,2,3,3,3,3,3,4];
  const EXP_3X = [
    1,1,1,1,2,2,1,1,1,
    1,2,2,1,1,1,2,2,2,
    2,2,2,3,3,3,3,3,3,
    3,4,4,3,3,3,3,4,4
  ];
  const EXP_4X = [
    1,1,1,1,1,1,2,2,1,1,1,1,
    1,1,2,2,1,1,1,1,2,2,2,2,
    1,1,1,1,2,2,2,2,2,2,2,2,
    3,3,3,3,2,2,2,3,3,3,3,3,
    3,3,3,3,3,3,4,4,3,3,3,3,
    3,3,4,4
  ];

  [2, 3, 4].forEach(function (scale) {
    it(`produces ${scale}x output`, function () {
      const out = resize(INPUT, 2, 2, scale);
      const expected = scale === 2 ? EXP_2X : scale === 3 ? EXP_3X : EXP_4X;
      expect(Array.from(out)).to.eql(expected);
    });
  });
});
