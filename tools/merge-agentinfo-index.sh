#!/bin/bash
# tools/merge-agentinfo-index.sh
# Merges .agentInfo/index.md and index-detailed.md in a stable way.


# Args: %O %A %B
ANCESTOR="$1"
CURRENT="$2"
OTHER="$3"

TMPFILE=$(mktemp)

# Combine all versions. $ANCESTOR may be a commit SHA rather than a file
if [ -f "$ANCESTOR" ]; then
  cat "$ANCESTOR" > "$TMPFILE"
elif git cat-file -e "$ANCESTOR:$CURRENT" 2>/dev/null; then
  git show "$ANCESTOR:$CURRENT" > "$TMPFILE"
else
  # No ancestor content
  > "$TMPFILE"
fi
cat "$CURRENT" >> "$TMPFILE"
if [ "$OTHER" != "$CURRENT" ]; then
  cat "$OTHER" >> "$TMPFILE"
fi

# Extract unique list entries (lines starting with - or *)
grep '^[-*] ' "$TMPFILE" | sort -u > merged_list.txt

# Reconstruct the file: keep header from CURRENT, append merged list
{
    # Keep header (first block of non-list lines)
    awk '/^[-*] /{exit} {print}' "$CURRENT"
    echo
    cat merged_list.txt
} > "$CURRENT"

# Clean up
rm -f "$TMPFILE" merged_list.txt
exit 0
