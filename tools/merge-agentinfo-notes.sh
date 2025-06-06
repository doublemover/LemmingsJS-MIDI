#!/bin/bash
# tools/merge-agentinfo-notes.sh
# Simple conflict-tolerant merge for notes/*.md

# Args: %O %A %B
ANCESTOR="$1"
CURRENT="$2"
OTHER="$3"

# Use diff3 to preserve both sides
diff3 -m "$ANCESTOR" "$CURRENT" "$OTHER" > "$CURRENT"

exit 0
