import { createOldVegasPack } from './OldVegasPack.js';
const pieces = createOldVegasPack().pieces;
const gadgetId = id => 12 + pieces.findIndex(p => p.id === id);
const CASINO_SHOWCASE = {
  width: 1280, height: 320,
  terrain: [0,256,512,768,1024].map(x => ({ id: 6, x, y: 272 })).concat([{ id: 9, x: 736, y: 176 }, { id: 6, x: 856, y: 176 }, { id: 11, x: 280, y: 264 }]),
  gadgets: [
    { id: 1, x: 18, y: 216 }, { id: 0, x: 1190, y: 226 },
    ...[0,256,512,768,1024].map(x => ({ id: gadgetId('casino-bulb-rope'), x, y: 0 })),
    ...[20,260,560,900,1190].map((x, i) => ({ id: gadgetId(i % 2 ? 'casino-black-pillar' : 'casino-white-pillar'), x, y: 104 })),
    { id: gadgetId('casino-velvet-proscenium'), x: 296, y: 75 },
    { id: gadgetId('casino-neon-crown'), x: 328, y: 20 },
    { id: gadgetId('hydro-showgirl'), x: 328, y: 76 },
    { id: gadgetId('hydro-showgirl-charleston'), x: 80, y: 84 },
    { id: gadgetId('hydro-showgirl-kickline'), x: 1090, y: 84 },
    { id: gadgetId('chips-face-500'), x: 605, y: 191 },
    { id: gadgetId('chips-side-25000'), x: 663, y: 213 },
    { id: gadgetId('slot-reels'), x: 812, y: 116 },
    { id: gadgetId('marquee-2'), x: 52, y: 59 },
    { id: gadgetId('marquee-3'), x: 1120, y: 59 },
    { id: 11, x: 910, y: 197 }
  ]
};
export { CASINO_SHOWCASE };
