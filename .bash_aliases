alias grep='grep --exclude-dir=.repoMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'
alias gitgrep='git grep -- . \":(exclude)index-code\" \":(exclude)index-prose\" \":(exclude).repoMetrics\"'
alias rg='rg --ignore-dir=.repoMetrics --ignore-dir=index-code --ignore-dir=index-prose'
# Redefine egrep and fgrep as grep variants (optional, for compatibility)
alias egrep='grep -E --exclude-dir=.repoMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'
alias fgrep='grep -F --exclude-dir=.repoMetrics --exclude-dir=index-code --exclude-dir=index-prose --color=auto'
alias search='node tools/search.js'
