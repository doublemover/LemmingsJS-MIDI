# Viewport vs world naming

tags: naming, cleanup

Variables referencing viewport size sometimes mix up with fields storing world data dimensions. This confusion can lead to scaling bugs when the wrong variable is used. Please rename unclear properties so it's obvious whether they describe the window viewport or the underlying world data.
