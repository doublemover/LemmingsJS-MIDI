# Viewport vs world naming

tags: naming, cleanup

Variables referencing viewport size sometimes mix up with fields storing world data dimensions. This confusion can lead to scaling bugs when the wrong variable is used. Please rename unclear properties so it's obvious whether they describe the window viewport or the underlying world data.

# Naming cleanup

tags: naming, cleanup

Viewport size often gets confused with the world data size.
Variables like `w`, `h` or `levelWidth` sometimes
refer to the canvas viewport while others mean the underlying
level dimensions. When you encounter ambiguous names,
rename them to clarify which space they describe. Keep this
note in mind for future refactors.
