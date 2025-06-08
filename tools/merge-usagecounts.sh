#!/usr/bin/env bash
#
# merge-usagecounts.sh: Git merge driver for .repoMetrics/usageCounts.json
# Args: base ours theirs

BASE="$1"
OURS="$2"
THEIRS="$3"

node "$(dirname "$0")/sumUsageCounts.js" "$BASE" "$OURS" "$THEIRS" "$OURS"
