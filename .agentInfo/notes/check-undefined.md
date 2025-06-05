# Check undefined calls

tags: tools, validation

`tools/check-undefined.js` scans JavaScript and HTML files for function calls. If a call cannot be resolved to a defined function, the script fails and reports the location.

Run `npm run check-undefined` after merges or large refactors to catch missing or renamed functions before committing.
