#!/bin/bash
# tools/merge-agentinfo-index.sh
# Merges .agentInfo/index.md and index-detailed.md in a stable way.

# Args: %O %A %B
ANCESTOR="$1"
CURRENT="$2"
OTHER="$3"

TMPFILE=$(mktemp)

# Combine all versions
cat "$ANCESTOR" "$CURRENT" "$OTHER" > "$TMPFILE"

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
