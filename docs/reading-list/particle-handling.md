# Particle Handling

The engine decodes explosion particle coordinates from a Base64 string. `ParticleTable` stores the decoded frames so they can be reused.

## Key Code

- The constructor lazily decodes the Base64 data and caches it for all instances【F:js/ParticleTable.js†L23-L26】.
- `#decodeBase64Frames()` converts the string into 51 frames using `atob` or `Buffer.from`【F:js/ParticleTable.js†L74-L96】.
- Unit tests verify the table contains 51 frames on creation【F:test/particletable.test.js†L20-L26】.

## Documentation references

- The main DAT format explains that explosion sprites are followed by a particle shower drawn separately by the game【F:docs/camanis/lemmings_main_dat_file_format.md†L105-L108】.
- The NeoLemmix format lists a 48-byte style header storing explosion colors under marker `0xFF02`【F:docs/nl-file-format.md†L146】.
