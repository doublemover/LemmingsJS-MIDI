# Check undefined calls

tags: tools, validation

`tools/check-undefined.js` scans JavaScript and HTML files for method calls. If it finds a call that cannot be resolved, it fails the build. Run `npm run check-undefined` (or `npm test`) after significant merges or large changes to catch missing or renamed functions early.
