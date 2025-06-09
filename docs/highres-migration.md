# Migrating Packs to High-Resolution True-Color Sprites

NeoLemmix packs built with 16‑color graphics continue to load without changes.
To take advantage of the new high‑resolution, 32‑bit sprite support:

1. Convert existing DAT graphics to PNG and place them in `styles/<set>-hr/`.
   Images should be exactly twice the pixel dimensions of their standard
   counterparts.
2. Keep the original 16‑color files in `styles/<set>/` as fallbacks.
3. Update any custom lemming sprite sheets to 32‑bit PNGs. The `scheme.nxmi`
   file does not change.
4. Rebuild archives with `npm run pack-levels` or your usual workflow.

Older engines will ignore the `-hr` folders and continue using the low‑resolution
sprites. New versions automatically load the high‑resolution PNGs when present.
