# Export scripts test coverage

tags: tests, tools, exports

Small Mocha tests create dummy packs and run the export tools via `node`.
Each script is patched to avoid bootstrapping and verifies a PNG file
is written before the temporary directories are removed.
