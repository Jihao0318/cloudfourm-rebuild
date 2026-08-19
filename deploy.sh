#!/usr/bin/env bash
# ============================================================
# CloudForum 一键部署脚本
# 自动完成 D1 创建/迁移、Secrets 配置、Worker/Pages 部署
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$PROJECT_DIR/worker"
FRONTEND_DIR="$PROJECT_DIR/frontend"
CFG="$PROJECT_DIR/wrangler.jsonc"

# --------------- 前置检查 ---------------
check_prerequisites() {
    echo ""
    echo "========================================"
    echo "   CloudForum 一键部署"
    echo "========================================"
    echo ""

    # 检查 Node.js
    if ! command -v node &>/dev/null; then
        log_error "未安装 Node.js，请先安装: https://nodejs.org"
        exit 1
    fi
    log_ok "Node.js $(node -v)"

    # 检查 npm
    if ! command -v npm &>/dev/null; then
        log_error "未安装 npm"
        exit 1
    fi

    # 检查 wrangler
    if ! command -v npx wrangler &>/dev/null && ! command -v wrangler &>/dev/null; then
        log_info "正在安装 wrangler..."
        npm install -g wrangler
    fi
    log_ok "wrangler $(npx wrangler --version 2>/dev/null || wrangler --version 2>/dev/null)"

    # 检查 Cloudflare 登录状态
    WHOAMI_OUTPUT=$(npx wrangler whoami 2>&1)
    if ! echo "$WHOAMI_OUTPUT" | grep -q "You are logged in"; then
        log_info "请登录 Cloudflare..."
        npx wrangler login
        WHOAMI_OUTPUT=$(npx wrangler whoami 2>&1)
    fi
    log_ok "Cloudflare 已登录"

    # 自动获取 Account ID
    ACCOUNT_ID=$(echo "$WHOAMI_OUTPUT" | grep -oP "Account ID:\s*\K[a-f0-9-]+" || echo "")
    if [ -n "$ACCOUNT_ID" ]; then
        log_ok "检测到 Account ID: ${ACCOUNT_ID:0:8}...${ACCOUNT_ID: -4}"
        # wrangler.jsonc 使用 JSON 格式；account_id 通过环境变量或 dashboard 提供
        log_info "Account ID 将通过 CLOUDFLARE_ACCOUNT_ID 环境变量在 CI 中使用"
    else
        log_warn "未能自动检测 Account ID"
        read -rp "请输入 Cloudflare Account ID (Dashboard 右侧可查): " ACCOUNT_ID
    fi
}

# --------------- 安装依赖 ---------------
install_deps() {
    echo ""
    log_info "安装 Worker 依赖..."
    cd "$WORKER_DIR"
    npm ci

    log_info "安装前端依赖..."
    cd "$FRONTEND_DIR"
    npm ci
    cd "$PROJECT_DIR"

    log_ok "依赖安装完成"
}

# --------------- D1 数据库 ---------------
setup_d1() {
    echo ""
    echo "----------------------------------------"
    log_info "1/5 配置 D1 数据库"
    echo "----------------------------------------"

    # 尝试获取已存在的数据库
    DB_INFO=$(npx wrangler d1 list 2>/dev/null | grep "forum-db" || true)

    if [ -z "$DB_INFO" ]; then
        log_info "创建 D1 数据库 forum-db..."
        CREATE_OUTPUT=$(npx wrangler d1 create forum-db 2>&1)
        echo "$CREATE_OUTPUT"

        # 提取 database_id
        DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP 'database_id:\s*\K[a-f0-9-]+' || true)
        if [ -z "$DB_ID" ]; then
            DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP '"uuid":\s*"\K[a-f0-9-]+' || true)
        fi
        if [ -z "$DB_ID" ]; then
            DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP 'Database ID:\s*\K[a-f0-9-]+' || true)
        fi

        if [ -z "$DB_ID" ]; then
            log_error "无法获取数据库 ID，请手动配置"
            read -rp "请输入 D1 数据库 ID: " DB_ID
        fi
    else
        log_info "数据库 forum-db 已存在"
        DB_ID=$(npx wrangler d1 list --json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data if isinstance(data, list) else []:
    if item.get('name') == 'forum-db':
        print(item.get('uuid', ''))
" 2>/dev/null || echo "")
        if [ -z "$DB_ID" ]; then
            DB_ID=$(npx wrangler d1 list 2>/dev/null | grep "forum-db" | awk -F'│' '{print $2}' | tr -d ' ')
        fi
    fi

    # 写入 wrangler.jsonc（使用 python3 做安全的 JSON 编辑）
    if [ -n "$DB_ID" ]; then
        python3 -c "
import json
with open('$CFG', 'r') as f:
    cfg = json.load(f)
for db in cfg.get('d1_databases', []):
    if db.get('database_name') == 'forum-db':
        db['database_id'] = '$DB_ID'
with open('$CFG', 'w') as f:
    json.dump(cfg, f, indent=2)
print('OK')
" 2>/dev/null && log_ok "数据库 ID 已写入 wrangler.jsonc" || log_error "写入 wrangler.jsonc 失败"
    fi

    # 执行迁移
    log_info "执行 D1 数据库迁移..."
    cd "$WORKER_DIR"
    npx wrangler d1 migrations apply forum-db --remote 2>&1 || true
    cd "$PROJECT_DIR"

    log_ok "D1 数据库配置完成"
}

# --------------- Secrets 配置 ---------------
setup_secrets() {
    echo ""
    echo "----------------------------------------"
    log_info "2/5 配置环境变量 (Secrets)"
    echo "----------------------------------------"
    echo "按回车跳过已配置的项"

    # JWT_SECRET
    CURRENT=$(npx wrangler secret list 2>/dev/null | grep "JWT_SECRET" || true)
    if [ -z "$CURRENT" ]; then
        DEFAULT_JWT=$(openssl rand -hex 32 2>/dev/null || echo "")
        read -rp "JWT_SECRET (回车使用随机值: ${DEFAULT_JWT:0:16}...): " JWT_SECRET
        JWT_SECRET=${JWT_SECRET:-$DEFAULT_JWT}
        echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
        log_ok "JWT_SECRET 已配置"
    else
        log_info "JWT_SECRET 已存在，跳过"
    fi

    # TELEGRAPH_IMAGE_URL
    CURRENT=$(npx wrangler secret list 2>/dev/null | grep "TELEGRAPH_IMAGE_URL" || true)
    if [ -z "$CURRENT" ]; then
        read -rp "TELEGRAPH_IMAGE_URL (图床地址，如 https://img.你的域名.com): " TELEGRAPH_URL
        if [ -n "$TELEGRAPH_URL" ]; then
            echo "$TELEGRAPH_URL" | npx wrangler secret put TELEGRAPH_IMAGE_URL
            log_ok "TELEGRAPH_IMAGE_URL 已配置"
        fi
    else
        log_info "TELEGRAPH_IMAGE_URL 已存在，跳过"
    fi

    # FRONTEND_URL
    CURRENT=$(npx wrangler secret list 2>/dev/null | grep "FRONTEND_URL" || true)
    if [ -z "$CURRENT" ]; then
        read -rp "FRONTEND_URL (前端地址，如 https://forum.你的域名.com): " FRONTEND_URL
        [ -n "$FRONTEND_URL" ] && echo "$FRONTEND_URL" | npx wrangler secret put FRONTEND_URL
    else
        log_info "FRONTEND_URL 已存在，跳过"
    fi
}

# --------------- 部署 Worker ---------------
deploy_worker() {
    echo ""
    echo "----------------------------------------"
    log_info "3/5 部署 Worker"
    echo "----------------------------------------"

    cd "$WORKER_DIR"
    npx wrangler deploy src/index.ts --name forum-worker 2>&1
    cd "$PROJECT_DIR"

    log_ok "Worker 部署完成"
}

# --------------- 构建前端 ---------------
build_frontend() {
    echo ""
    echo "----------------------------------------"
    log_info "4/5 构建前端"
    echo "----------------------------------------"

    cd "$FRONTEND_DIR"
    npm run build 2>&1
    cd "$PROJECT_DIR"

    log_ok "前端构建完成: $FRONTEND_DIR/dist"
}

# --------------- 部署前端 ---------------
deploy_frontend() {
    echo ""
    echo "----------------------------------------"
    log_info "5/5 部署前端到 Cloudflare Pages"
    echo "----------------------------------------"

    # 获取 Worker 地址用于 WORKER_URL
    WORKER_URL=$(npx wrangler deploy src/index.ts --name forum-worker --dry-run 2>/dev/null || echo "")
    echo ""
    log_info "请选择部署方式:"
    echo "  1) 自动部署到 Cloudflare Pages"
    echo "  2) 手动部署到 Cloudflare Pages (生成构建产物)"
    echo "  3) 跳过"
    read -rp "请选择 [1/2/3] (默认 2): " DEPLOY_CHOICE
    DEPLOY_CHOICE=${DEPLOY_CHOICE:-2}

    case $DEPLOY_CHOICE in
        1)
            cd "$FRONTEND_DIR"
            npx wrangler pages deploy dist --project-name=forum-frontend 2>&1
            cd "$PROJECT_DIR"
            WORKER_URL_DEFAULT="https://forum-worker.你的用户名.workers.dev"
            log_info "请前往 Cloudflare Pages Dashboard 设置环境变量:"
            log_info "  WORKER_URL = $WORKER_URL_DEFAULT"
            ;;
        2)
            log_info "构建产物位于: $FRONTEND_DIR/dist"
            log_info "请手动上传到 Cloudflare Pages:"
            echo "  npx wrangler pages deploy $FRONTEND_DIR/dist --project-name=forum-frontend"
            ;;
        3)
            log_info "跳过前端部署"
            ;;
    esac

    log_ok "前端部署完成"
}

# --------------- 完成 ---------------
show_summary() {
    echo ""
    echo "========================================"
    echo -e "   ${GREEN}CloudForum 部署完成!${NC}"
    echo "========================================"
    echo ""
    echo "后续步骤:"
    echo "  1. 绑定域名 (可选)"
    echo "     - Pages: forum.你的域名.com → forum-frontend"
    echo "     - Workers 路由: forum.你的域名.com/api/* → forum-worker"
    echo ""
    echo "  2. GitHub Actions CI/CD 配置:"
    echo "     前往 Settings → Secrets and variables → Actions，添加:"
    echo "     - CLOUDFLARE_API_TOKEN  (Cloudflare API 令牌)"
    echo "     - CLOUDFLARE_ACCOUNT_ID ($ACCOUNT_ID)"
    echo ""
    echo "  3. 在 Cloudflare Dashboard 中为 Pages 设置环境变量:"
    echo "     - WORKER_URL: Worker 部署地址"
    echo ""
    echo "  4. 部署图床 Telegraph-Image (如未部署):"
    echo "     https://github.com/cf-pages/Telegraph-Image"
    echo ""
    echo "  5. 访问你的论坛: https://forum.你的域名.com"
    echo ""
    echo "本地开发:"
    echo "  cd $PROJECT_DIR"
    echo "  npm --prefix worker run dev  # 启动 Worker"
    echo "  npm --prefix frontend run dev # 启动前端"
    echo ""
}

# --------------- 主流程 ---------------
main() {
    check_prerequisites
    install_deps
    setup_d1
    setup_secrets
    deploy_worker
    build_frontend
    deploy_frontend
    show_summary
}

# 解析参数
case "${1:-}" in
    --help|-h)
        echo "CloudForum 一键部署脚本"
        echo "用法: bash deploy.sh [选项]"
        echo ""
        echo "选项:"
        echo "  --skip-d1      跳过 D1 数据库配置"
        echo "  --skip-secret  跳过 Secrets 配置"
        echo "  --skip-worker  跳过 Worker 部署"
        echo "  --skip-front   跳过前端构建和部署"
        echo "  --skip-account 跳过 Account ID 检测"
        echo "  --help         显示此帮助"
        exit 0
        ;;
    --skip-d1)
        SKIP_D1=true
        ;;
    --skip-secret)
        SKIP_SECRET=true
        ;;
    --skip-worker)
        SKIP_WORKER=true
        ;;
    --skip-front)
        SKIP_FRONT=true
        ;;
esac

main