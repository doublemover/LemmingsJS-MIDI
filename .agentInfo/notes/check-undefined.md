# Check undefined calls

tags: tools, validation

`tools/check-undefined.js` scans JavaScript and HTML files for function or method invocations. If a call cannot be matched to a defined function, the script fails and reports the location.

Run `npm run check-undefined` (also part of `npm test`) after large merges or refactors to catch missing or renamed functions before committing.
