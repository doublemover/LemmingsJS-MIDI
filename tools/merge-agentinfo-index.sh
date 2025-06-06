#!/bin/bash
# tools/merge-agentinfo-index.sh
# Merges .agentInfo/index.md and index-detailed.md preserving duplicates as nested bullets

ANCESTOR="$1"
CURRENT="$2"
OTHER="$3"

TMPFILE=$(mktemp)
cat "$ANCESTOR" "$CURRENT" "$OTHER" > "$TMPFILE"

if grep -q '^[-*] ' "$TMPFILE"; then
  awk '
    /^[-*] / {
      line=substr($0,3)
      if (match(line,/\[([^]]+)\]/,arr)) { path=arr[1] } else { path=line }
      key=path FS line
      if (!(path in first)) { first[path]="- " line; order[++count]=path }
      else if (!(key in seen)) { extra[path]=extra[path] "\n  - " line }
      seen[key]=1
      next
    }
    { header=header $0 "\n" }
    END {
      printf "%s", header;
      for(i=1;i<=count;i++){ p=order[i]; print first[p]; if(extra[p]) printf "%s", extra[p] }
    }
  ' "$TMPFILE" > "$CURRENT"
else
  awk '
    /^[^#].*:/ {
      path=$1; sub(/:/,"",path); tags=substr($0, index($0,":")+2)
      key=path ":" tags
      if (!(path in first)) { first[path]=path ": " tags; order[++count]=path }
      else if (!(key in seen)) { extra[path]=extra[path] "\n- " tags }
      seen[key]=1
      next
    }
    { header=header $0 "\n" }
    END {
      printf "%s", header;
      for(i=1;i<=count;i++){ p=order[i]; print first[p]; if(extra[p]) printf "%s", extra[p] }
    }
  ' "$TMPFILE" > "$CURRENT"
fi

rm -f "$TMPFILE"
exit 0
