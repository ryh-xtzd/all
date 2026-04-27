#!/usr/bin/env zsh
set -euo pipefail

# Usage:
#   ./deploy.sh
#   ./deploy.sh https://github.com/<user>/<repo>.git

if [[ ! -d .git ]]; then
  git init
fi

# Ensure main branch exists and is current
current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$current_branch" || "$current_branch" == "HEAD" ]]; then
  git checkout -B main
elif [[ "$current_branch" != "main" ]]; then
  git checkout -B main
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

# Allow first-time commit even if global git identity is missing
if ! git config user.name >/dev/null 2>&1; then
  git config user.name "GitHub Pages Deployer"
fi
if ! git config user.email >/dev/null 2>&1; then
  git config user.email "deployer@users.noreply.github.com"
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "chore: setup GitHub Pages deployment"
fi

git push -u origin main

remote=$(git remote get-url origin)
repo_path="${remote##*github.com[:/]}"
repo_path="${repo_path%.git}"
repo_name="${repo_path##*/}"
owner="${repo_path%/*}"

printf "\nDone. GitHub Actions is deploying your site.\n"
printf "Actions: https://github.com/%s/actions\n" "$repo_path"
printf "Pages:   https://%s.github.io/%s/\n" "$owner" "$repo_name"
