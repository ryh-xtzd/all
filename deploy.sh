#!/usr/bin/env zsh
set -euo pipefail

# Usage:
#   ./deploy.sh https://github.com/<user>/<repo>.git
# If remote already exists, argument can be omitted.

if [[ ! -d .git ]]; then
  git init
  git symbolic-ref HEAD refs/heads/main
fi

if [[ $# -ge 1 ]]; then
  remote_url="$1"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$remote_url"
  else
    git remote add origin "$remote_url"
  fi
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Error: missing origin remote."
  echo "Run: ./deploy.sh https://github.com/<user>/<repo>.git"
  exit 1
fi

git add .
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "chore: setup GitHub Pages deployment"
fi

git push -u origin main

echo "Pushed successfully. GitHub Actions will deploy the site automatically."
