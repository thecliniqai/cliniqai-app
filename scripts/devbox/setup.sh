#!/usr/bin/env bash
# clinicOS dev machine setup (Ubuntu 24.04 LTS, x86_64). Synthetic data only: never copy a .env* file, a staging or
# production key, or real data onto this machine.
#
# Run once as your normal login user (not root):  bash setup.sh
# Installs: base tools, Docker Engine, Node 24 (nvm), GitHub CLI, Claude Code, a swap file and file-watch limits.
# The Supabase CLI comes with the repo (npm devDependency `supabase`), so it is not installed here.
# Safe to re-run: every step checks before it changes anything.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then echo "Run as your login user, not root (sudo is used where needed)."; exit 1; fi
. /etc/os-release
if [ "${VERSION_ID:-}" != "24.04" ]; then echo "Expected Ubuntu 24.04 (CI runs ubuntu-24.04); found ${PRETTY_NAME:-unknown}."; exit 1; fi
if [ "$(uname -m)" != "x86_64" ]; then echo "Expected x86_64 (CI is x86_64); found $(uname -m)."; exit 1; fi

say() { printf '\n==> %s\n' "$*"; }

say "Base packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg git tmux jq unzip rsync build-essential less nano htop

say "Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

say "GitHub CLI"
if ! command -v gh >/dev/null 2>&1; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg status=none
  sudo chmod a+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y gh
fi

say "Node 24 (nvm)"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24

say "Claude Code"
if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
  curl -fsSL https://claude.ai/install.sh | bash
fi
grep -q 'HOME/.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

say "Swap (8 GB safety net) and file-watch limits"
if ! swapon --show | grep -q '/swapfile'; then
  sudo fallocate -l 8G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/90-clinicos-watches.conf >/dev/null
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/91-clinicos-swap.conf >/dev/null
sudo sysctl --system >/dev/null

say "Versions"
docker --version || true
node --version
npm --version
gh --version | head -1
"$HOME/.local/bin/claude" --version 2>/dev/null || claude --version 2>/dev/null || echo "claude: open a new shell to see it"

cat <<'EOF'

Done. Next (you, once):
  1. Log out and back in (so the docker group applies), then:   docker run --rm hello-world
  2. gh auth login          (GitHub.com, HTTPS, log in with a browser)
  3. gh repo clone thecliniqai/cliniqai-app ~/clinicOS && cd ~/clinicOS && git switch v2/phase-09e-caching-speed
  4. tmux new -s claude     then run:  claude    (sign in with your claude.ai account; turn on Remote Control)
Claude then runs: npm ci, npx playwright install --with-deps chromium webkit, the local Supabase stack, the GSD
install and a first test run. Detach from tmux with Ctrl-b then d; reattach with: tmux attach -t claude
EOF
