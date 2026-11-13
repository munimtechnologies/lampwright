#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Munim, Inc. Made with AI agents for MV2 of Munim, Inc.
# Builds Lampwright on top of a fresh clone of reddit/devvit-template-bare and runs
# every check, one phase per call: sh ci/sealed-job.sh <phase>. Source in /work,
# results in /out, the assembled app in /tmp/app. Phases print "<phase> exit=N".
set -u
W=/work
A=/tmp/app
O=/out
NODE_TS="node --experimental-strip-types --no-warnings=ExperimentalWarning"
phase="$1"
case "$phase" in
  engine)
    node --version
    cd $W && $NODE_TS --test src/shared/puzzle.test.ts src/shared/share.test.ts src/shared/board.test.ts \
      src/shared/countdown.test.ts src/shared/journey.test.ts > $O/engine-unit.log 2>&1
    echo "engine exit=$?"; tail -n 40 $O/engine-unit.log ;;
  genstats)
    cd $W && timeout 1200 $NODE_TS tools/genstats.ts 2026-11-12 120 $O/genstats.jsonl > $O/genstats.txt 2>&1
    echo "genstats exit=$?"; cat $O/genstats.txt ;;
  assemble)
    git clone -q --depth 1 https://github.com/reddit/devvit-template-bare /tmp/tb || { echo "assemble exit=1"; exit 0; }
    git -C /tmp/tb log -1 --format=%H > $O/template-sha.txt
    rm -rf /tmp/tb/.git && cp -r /tmp/tb $A
    mkdir -p $O/template && cp -r /tmp/tb/LICENSE /tmp/tb/src /tmp/tb/public /tmp/tb/package.json /tmp/tb/devvit.json /tmp/tb/biome.jsonc /tmp/tb/tsconfig.json /tmp/tb/tsconfig.base.json $O/template/
    mv $A/LICENSE $A/LICENSE-devvit-template-bare
    rm -f $A/readme.md $A/public/snoo.png
    cp -r $W/src/. $A/src/
    cp $W/public/*.html $A/public/
    cp -r $W/tools $W/ci $A/
    cp $W/devvit.json $W/README.md $A/
    sed -i 's/<% name %>/lampwright/g; s/"license": "BSD-3-Clause"/"license": "Apache-2.0"/' $A/package.json
    # v0.5: the builder page is a third client bundle
    sed -i 's#src/client/game.ts#src/client/game.ts src/client/build.ts#' $A/package.json
    grep -n 'build:client' $A/package.json
    grep -c 'src/client/build.ts' $A/package.json
    grep -rn '<% name %>' $A --include=*.json --include=*.ts --include=*.html | grep -v node_modules
    # v0.8b (F8): one countdown module only
    echo "F8 stray countdown names: $(grep -rn 'countdownText\|msUntilNextPost' $A/src | wc -l)"
    find $A -type f -not -path '*/node_modules/*' | sort > $O/app-files.txt
    echo "assemble exit=0"; cat $O/template-sha.txt; cat $O/app-files.txt ;;
  install)
    # v0.7: Journeys need @devvit/analytics (same 0.15 line as @devvit/web) and express for its server router
    cd $A && npm install --no-audit --no-fund > $O/npm-install.log 2>&1 \
      && npm install --no-audit --no-fund @devvit/analytics@0.15.3 express@5 >> $O/npm-install.log 2>&1 \
      && npm install --no-audit --no-fund -D @types/express@5 >> $O/npm-install.log 2>&1
    echo "install exit=$?"; tail -n 8 $O/npm-install.log
    grep -E '"@devvit/(web|analytics)"|"express"|"@types/express"' $A/package.json ;;
  format)
    cd $A && npx biome check --write . > $O/biome-write.log 2>&1
    echo "format exit=$?"; tail -n 60 $O/biome-write.log
    mkdir -p $O/app-src && cp -r src public tools ci devvit.json README.md package.json $O/app-src/
    rm -f $O/app-src/public/*.js $O/app-src/public/*.js.map ;;
  types)
    cd $A && npm run test:types > $O/types.log 2>&1
    echo "types exit=$?"; tail -n 60 $O/types.log ;;
  lint)
    cd $A && npm run lint > $O/lint.log 2>&1
    echo "lint exit=$?"; tail -n 80 $O/lint.log ;;
  unit)
    cd $A && npm run test:unit > $O/unit.log 2>&1
    echo "unit exit=$?"; tail -n 60 $O/unit.log ;;
  globcheck)
    # v0.8 (F7): does the template's unquoted test:unit glob reach a test two folders deep?
    mkdir -p $A/src/deep/er
    printf "import {test} from 'node:test'\ntest('nested canary', () => { throw Error('NESTED_CANARY_RAN') })\n" > $A/src/deep/er/canary.test.ts
    cd $A && npm run test:unit > $O/globcheck.log 2>&1
    echo "globcheck exit=$?"; echo "nested canary lines: $(grep -c 'nested canary' $O/globcheck.log)"; ls -l /bin/sh
    rm -rf $A/src/deep ;;
  build)
    cd $A && npm run build > $O/build.log 2>&1
    echo "build exit=$?"; tail -n 20 $O/build.log; ls -la $A/public $A/dist/server 2>/dev/null ;;
  fulltest)
    cd $A && npm test > $O/npm-test.log 2>&1
    echo "fulltest exit=$?"; tail -n 15 $O/npm-test.log ;;
  browser)
    cd $A && npm install --no-save --no-audit --no-fund playwright > $O/playwright-install.log 2>&1 \
      && npx playwright install --with-deps chromium >> $O/playwright-install.log 2>&1
    echo "browser exit=$?"; tail -n 5 $O/playwright-install.log ;;
  e2e)
    cd $A && ($NODE_TS tools/harness.ts 8787 > $O/harness.log 2>&1 &)
    sleep 8
    cd $A && timeout 420 $NODE_TS tools/e2e.ts http://127.0.0.1:8787 $O/e2e > $O/e2e.log 2>&1
    echo "e2e exit=$?"; cat $O/e2e.log; tail -n 20 $O/harness.log ;;
  *)
    echo "unknown phase $phase"; exit 2 ;;
esac
exit 0
