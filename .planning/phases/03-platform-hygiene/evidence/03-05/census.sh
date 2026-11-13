#!/bin/sh
# Usage: census.sh <rev>   (UTC "today" census, V2-03 03-05)
REV="$1"
A='toISOString\(\)\.(split\("T"\)\[0\]|slice\(0, ?10\)|substring\(0, ?10\))'
B='\.split\("T"\)\[0\]'
C='T00:00:00(\.000)?Z|T23:59:59(\.999)?Z|\+05:30'
echo "rev: $(git rev-parse --short "$REV")"
echo "== A: toISOString() date split/slice"
git grep -nE "$A" "$REV" -- app components features lib
echo "== B: other timestamp .split(\"T\")[0] (not A)"
git grep -nE "$B" "$REV" -- app components features lib | grep -vE "$A"
echo "== C: UTC day-window / fixed-offset literals"
git grep -nE "$C" "$REV" -- app components features lib
echo "== counts"
echo "A lines: $(git grep -nE "$A" "$REV" -- app components features lib | wc -l | tr -d ' ')"
echo "B lines: $(git grep -nE "$B" "$REV" -- app components features lib | grep -vE "$A" | wc -l | tr -d ' ')"
echo "C lines: $(git grep -nE "$C" "$REV" -- app components features lib | wc -l | tr -d ' ')"
