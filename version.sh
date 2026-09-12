#!/bin/sh
set -eu

VERSION=${1:-}
if ! printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
	echo "Usage: $0 <major.minor.patch>" >&2
	exit 1
fi

npx -y @biomejs/biome@1.9.4 check . --write

jq --tab --arg version "$VERSION" '.version = $version | .download = ("https://github.com/RaiNaifa/litm-rn/releases/download/v" + $version + "/litm-rn.zip")' system.json > temp.json
mv temp.json system.json

git add -A
git commit -m "Release v$VERSION"
git tag "v$VERSION" -m "v$VERSION"
