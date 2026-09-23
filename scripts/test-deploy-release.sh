#!/usr/bin/env bash
set -euo pipefail
# Exercise the actual deployment script against a local fake transport. The
# shims execute its remote shell locally; no SSH or HTTP request is possible.
repo=$(pwd)
# Git Bash cannot create native symlinks without Windows privileges and does
# not ship flock. On Windows only, model link contents for branch/guard tests;
# Linux CI exercises the real symlink replacement and lock commands.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    test() { if [[ "${1:-}" == -L ]]; then builtin test -f "$2"; else builtin test "$@"; fi; }
    ln() { builtin test "$1" = -s; printf '%s' "$2" > "$3"; }
    readlink() { cat "$1"; }
    flock() { :; }
    export -f test ln readlink flock
    echo 'Windows simulation: symlink and lock primitives are modeled; Linux CI uses real primitives.'
    ;;
esac
test_root=$(mktemp -d "${TMPDIR:-/tmp}/higo-release-integration-XXXXXX")
cleanup() {
  case "$test_root" in "${TMPDIR:-/tmp}"/higo-release-integration-*) rm -rf -- "$test_root";; *) exit 2;; esac
}
trap cleanup EXIT
mkdir -p "$test_root/bin" "$test_root/app/scripts" "$test_root/app/android/app" "$test_root/app/dist/assets" "$test_root/app/dist/api"
cp scripts/deploy-release.sh scripts/release-manifest.mjs scripts/verify-release.mjs "$test_root/app/scripts/"
printf '%s' '{"version":"1.0.0"}' > "$test_root/app/package.json"
printf '%s\n' 'versionName "1.0.0"' 'versionCode 1' > "$test_root/app/android/app/build.gradle"
printf '%s' '<html><script src="./assets/index.js"></script></html>' > "$test_root/app/dist/index.html"
printf '%s' 'console.log("fixture");' > "$test_root/app/dist/assets/index.js"
printf '%s' 'Options -Indexes' > "$test_root/app/dist/.htaccess"
export ACTUAL_NODE
ACTUAL_NODE=$(command -v node)
cat > "$test_root/bin/ssh" <<'SSH'
#!/usr/bin/env bash
set -euo pipefail
[[ " $* " == *' StrictHostKeyChecking=yes '* ]] || exit 95
[[ " $* " == *' UserKnownHostsFile='* ]] || exit 96
while [[ "$1" != fake@host.invalid ]]; do shift; done
shift
exec "$@"
SSH
cat > "$test_root/bin/scp" <<'SCP'
#!/usr/bin/env bash
set -euo pipefail
[[ " $* " == *' StrictHostKeyChecking=yes '* ]] || exit 97
args=("$@")
source=${args[${#args[@]}-2]}; destination=${args[${#args[@]}-1]}
[[ "$destination" == fake@host.invalid:* ]] || exit 98
cp "$source" "${destination#fake@host.invalid:}"
SCP
cat > "$test_root/bin/node" <<'NODE'
#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *' --remote '* ]]; then
  [ "$SIMULATED_HEALTH" = success ] && exit 0
  if [ "$SIMULATED_HEALTH" = superseded ]; then
    ln -s "$DEPLOY_ROOT/releases/newer" "$DEPLOY_ROOT/newer-current"
    mv -Tf "$DEPLOY_ROOT/newer-current" "$DEPLOY_ROOT/current"
  fi
  exit 1
fi
exec "$ACTUAL_NODE" "$@"
NODE
chmod +x "$test_root/bin/ssh" "$test_root/bin/scp" "$test_root/bin/node"
export PATH="$test_root/bin:$PATH"
export RELEASE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa VITE_GIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export RELEASE_ENVIRONMENT=staging VITE_APP_ENV=staging DEPLOY_HOST=host.invalid DEPLOY_USER=fake DEPLOY_PORT=22
export DEPLOY_SSH_KEY=synthetic-key DEPLOY_KNOWN_HOSTS=synthetic-known-host PUBLIC_BASE_URL=https://host.invalid
export GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=1
cd "$test_root/app"
node scripts/release-manifest.mjs
for scenario in success failed superseded; do
  export DEPLOY_ROOT="$test_root/$scenario" SIMULATED_HEALTH="$scenario"
  mkdir -p "$DEPLOY_ROOT/releases/old" "$DEPLOY_ROOT/releases/newer" "$DEPLOY_ROOT/shared"
  printf '%s' '<html>Previous version</html>' > "$DEPLOY_ROOT/releases/old/index.html"
  ln -s "$DEPLOY_ROOT/releases/old" "$DEPLOY_ROOT/current"
  if bash scripts/deploy-release.sh > "$test_root/$scenario.log" 2>&1; then status=0; else status=$?; fi
  case "$scenario" in
    success) test "$status" = 0; test "$(readlink "$DEPLOY_ROOT/current")" = "$DEPLOY_ROOT/releases/$RELEASE_SHA-123-1";;
    failed) test "$status" != 0; test "$(readlink "$DEPLOY_ROOT/current")" = "$DEPLOY_ROOT/releases/old";;
    superseded) test "$status" != 0; test "$(readlink "$DEPLOY_ROOT/current")" = "$DEPLOY_ROOT/releases/newer";;
  esac
  echo "Verified local deployment scenario: $scenario"
done
cd "$repo"
