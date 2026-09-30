#!/usr/bin/env bash
set -euo pipefail
# Run only in the deployment job, after downloading its immutable build artifact.
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_ROOT:?}" "${DEPLOY_PORT:=22}"
: "${DEPLOY_KNOWN_HOSTS:?}" "${DEPLOY_SSH_KEY:?}" "${RELEASE_SHA:?}" "${PUBLIC_BASE_URL:?}" "${RELEASE_ENVIRONMENT:?}"
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$DEPLOY_USER" =~ ^[a-zA-Z0-9_-]+$ && "$DEPLOY_PORT" =~ ^[0-9]+$ ]] || exit 2
[[ "$DEPLOY_ROOT" =~ ^/[a-zA-Z0-9_/-]+$ && "$DEPLOY_ROOT" != / && "$DEPLOY_ROOT" != *..* ]] || exit 2
[[ "$PUBLIC_BASE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || exit 2
test -f dist/release.json
node scripts/verify-release.mjs
key_dir=$(mktemp -d)
trap 'rm -rf "$key_dir"' EXIT
chmod 700 "$key_dir"
printf '%s\n' "$DEPLOY_SSH_KEY" > "$key_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$key_dir/known_hosts"
chmod 600 "$key_dir/key" "$key_dir/known_hosts"
remote="${DEPLOY_USER}@${DEPLOY_HOST}"
ssh_opts=(-i "$key_dir/key" -p "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$key_dir/known_hosts")
release_id="${RELEASE_SHA}-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
[[ "$release_id" =~ ^[a-f0-9]{40}-[a-zA-Z0-9]+-[0-9]+$ ]] || exit 2
# A release root must be provisioned outside the current document root.
ssh "${ssh_opts[@]}" "$remote" bash -s -- "$DEPLOY_ROOT" "$release_id" <<'PREPARE'
set -euo pipefail
root=$1; release=$2
test -d "$root/releases" && test -d "$root/shared"
test -L "$root/current"
current=$(readlink "$root/current")
case "$current" in "$root"/releases/*) test -d "$current" && test -s "$current/index.html";; *) echo 'Provision a known good current release first' >&2; exit 1;; esac
mkdir "$root/releases/$release"
PREPARE
tar -czf "$key_dir/release.tar.gz" -C dist .
archive_sha=$(sha256sum "$key_dir/release.tar.gz" | cut -d' ' -f1)
scp -i "$key_dir/key" -P "$DEPLOY_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$key_dir/known_hosts" "$key_dir/release.tar.gz" "$remote:$DEPLOY_ROOT/releases/$release_id/release.tar.gz"
previous=$(ssh "${ssh_opts[@]}" "$remote" bash -s -- "$DEPLOY_ROOT" "$release_id" "$archive_sha" <<'ACTIVATE'
set -euo pipefail
root=$1; release=$2; digest=$3
exec 9>"$root/.deploy.lock"
flock -x 9
cd "$root/releases/$release"
printf '%s  release.tar.gz\n' "$digest" | sha256sum -c - >/dev/null
tar -xzf release.tar.gz
rm release.tar.gz
test -s index.html && test -s release.json
# PHP private configuration stays outside releases. shared/api contains only
# locally provisioned private files, never public endpoints.
if [ -d "$root/shared/api" ]; then
  for file in "$root/shared/api/"* "$root/shared/api/".[!.]*; do
    [ -f "$file" ] || continue
    name=$(basename "$file")
    [[ "$name" == _* || "$name" == .user.ini ]] || { echo "Unexpected shared configuration file" >&2; exit 1; }
    [ ! -e "api/$name" ] || { echo "Shared configuration overlaps release code" >&2; exit 1; }
    ln -s "$file" "api/$name"
  done
fi
old=$(readlink "$root/current" || true)
ln -s "$root/releases/$release" "$root/current.$release"
mv -Tf "$root/current.$release" "$root/current"
printf '%s' "$old"
ACTIVATE
)
if ! node scripts/verify-release.mjs --remote; then
  # Compare current before restoring; never overwrite a newer deployment.
  ssh "${ssh_opts[@]}" "$remote" bash -s -- "$DEPLOY_ROOT" "$release_id" "$previous" <<'ROLLBACK'
set -euo pipefail
root=$1; release=$2; previous=$3
exec 9>"$root/.deploy.lock"
flock -x 9
[ "$(readlink "$root/current")" = "$root/releases/$release" ] || exit 1
case "$previous" in "$root"/releases/*) test -d "$previous";; *) echo 'No previous release exists; operator action required' >&2; exit 1;; esac
ln -s "$previous" "$root/rollback.$release"
mv -Tf "$root/rollback.$release" "$root/current"
ROLLBACK
  echo 'Release health check failed; previous release restored.' >&2
  exit 1
fi
echo "Published verified release $RELEASE_SHA"
