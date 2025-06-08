#!/bin/bash
# tools/merge-agentinfo-notes.sh
# Simple conflict-tolerant merge for notes/*.md

# Args: %O %A %B
ANCESTOR="$1"
CURRENT="$2"
OTHER="$3"

# Create empty files if needed to avoid diff3 errors
TMP_ANCESTOR="$ANCESTOR"
TMP_OTHER="$OTHER"

if [ ! -f "$ANCESTOR" ]; then
  TMP_ANCESTOR=$(mktemp)
  touch "$TMP_ANCESTOR"
fi

if [ ! -f "$OTHER" ]; then
  TMP_OTHER=$(mktemp)
  touch "$TMP_OTHER"
fi

# Use diff3 to preserve both sides.
diff3 -m "$TMP_ANCESTOR" "$CURRENT" "$TMP_OTHER" > "$CURRENT"

# Clean up temporary files
if [ "$TMP_ANCESTOR" != "$ANCESTOR" ]; then
  rm -f "$TMP_ANCESTOR"
fi

if [ "$TMP_OTHER" != "$OTHER" ]; then
  rm -f "$TMP_OTHER"
fi

exit 0
