import { Lemmings } from './LemmingsNamespace.js';


export const GameTypes = Object.freeze({ UNKNOWN:0, LEMMINGS:1, OHNO:2, XMAS91:3, XMAS92:4, HOLIDAY93:5, HOLIDAY94:6 });

Lemmings.GameTypes = GameTypes;

/*GameTypes[GameTypes["XMAS91"] = 3] = "XMAS91";
GameTypes[GameTypes["XMAS92"] = 4] = "XMAS92";
GameTypes[GameTypes["HOLIDAY93"] = 5] = "HOLIDAY93";
GameTypes[GameTypes["HOLIDAY94"] = 6] = "HOLIDAY94";*/


// function toString(type) {
//     return GameTypes[type];
// }
// GameTypes.toString = toString;

// function length() {
//     return 7;
// }
// GameTypes.length = length;

// function isValid(type) {
//     return ((type > GameTypes.UNKNOWN) && (type < this.length()));
// }
// GameTypes.isValid = isValid;
// /** return the GameTypes with the given name */
// function fromString(typeName) {
//     typeName = typeName.trim().toUpperCase();
//     for (let i = 0; i < this.length(); i++) {
//         if (GameTypes[i] == typeName) {
//             return i;
//         }
//     }
//     return GameTypes.UNKNOWN;
// }
// GameTypes.fromString = fromString;
