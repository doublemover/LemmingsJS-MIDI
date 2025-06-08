alias grep='grep --exclude-dir=.searchMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'
alias gitgrep='git grep -- . \":(exclude)index-code\" \":(exclude)index-prose\" \":(exclude).searchMetrics\"'
alias rg='rg --ignore-dir=.searchMetrics --ignore-dir=index-code --ignore-dir=index-prose'
# Redefine egrep and fgrep as grep variants (optional, for compatibility)
alias egrep='grep -E --exclude-dir=.searchMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'
alias fgrep='grep -F --exclude-dir=.searchMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'