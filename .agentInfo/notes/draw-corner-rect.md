# drawCornerRect note

tags: canvas, helper

`DisplayImage.drawCornerRect(x, y, size, r, g, b, length = 1, midLine = false, midLen = 0)` draws L-shaped corners. `length` controls how far each arm extends from the corner. When `midLine` is true it also draws short lines centered on each side using `midLen` as their length. GameDisplay uses the default arguments for its selection and hover outlines.
