# Naming cleanup

tags: naming, cleanup

Viewport size often gets confused with the world data size.
Variables like `w`, `h` or `levelWidth` sometimes
refer to the canvas viewport while others mean the underlying
level dimensions. When you encounter ambiguous names,
rename them to clarify which space they describe. Keep this
note in mind for future refactors.
