# Check undefined calls

tags: tools, validation


`tools/check-undefined.js` scans JavaScript and HTML files for method calls. If it finds a call that cannot be resolved, it fails the build. Run `npm run check-undefined` (or `npm test`) after significant merges or large changes to catch missing or renamed functions early.
`tools/check-undefined.js` scans JavaScript and HTML files for function or method invocations. If a call cannot be matched to a defined function, the script fails and reports the location.

Run `npm run check-undefined` (also part of `npm test`) after large merges or refactors to catch missing or renamed functions before committing.
