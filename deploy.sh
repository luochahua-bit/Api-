#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ============================================================
# Setup: Install Docker + Nginx + generate SSL
# ============================================================
setup() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  LLM API Relay - Server Setup${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""

    # Check if running as root
    if [ "$EUID" -ne 0 ]; then
        err "Please run as root: sudo ./deploy.sh setup"
    fi

    # Install Docker
    if ! command -v docker &> /dev/null; then
        log "Installing Docker..."
        curl -fsSL https://get.docker.com | sh
        systemctl enable docker
        systemctl start docker
        log "Docker installed"
    else
        log "Docker already installed"
    fi

    # Install Docker Compose
    if ! docker compose version &> /dev/null; then
        log "Installing Docker Compose..."
        apt-get install -y docker-compose-plugin 2>/dev/null || {
            curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/bin/docker-compose
            chmod +x /usr/local/bin/docker-compose
        }
        log "Docker Compose installed"
    else
        log "Docker Compose already installed"
    fi

    # Generate self-signed SSL certificate (for initial setup)
    if [ ! -f nginx/ssl/cert.pem ] || [ ! -f nginx/ssl/key.pem ]; then
        log "Generating self-signed SSL certificate..."
        mkdir -p nginx/ssl
        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout nginx/ssl/key.pem \
            -out nginx/ssl/cert.pem \
            -subj "/C=CN/ST=State/L=City/O=LLMRelay/CN=$(hostname -I | awk '{print $1}')" 2>/dev/null
        log "SSL certificate generated (self-signed)"
        warn "For production, replace with Let's Encrypt certificate:"
        warn "  1. Point your domain to this server's IP"
        warn "  2. Run: sudo ./deploy.sh ssl your-domain.com"
    fi

    # Configure firewall
    if command -v ufw &> /dev/null; then
        log "Configuring firewall..."
        ufw allow 22/tcp >/dev/null 2>&1
        ufw allow 80/tcp >/dev/null 2>&1
        ufw allow 443/tcp >/dev/null 2>&1
        ufw --force enable >/dev/null 2>&1
        log "Firewall configured (ports 22, 80, 443)"
    fi

    # Generate secure credentials if .env has defaults
    if grep -q "admin123" .env 2>/dev/null; then
        log "Generating secure credentials..."
        ADMIN_PASS=$(openssl rand -hex 16)
        API_KEY="sk-$(openssl rand -hex 24)"
        sed -i "s/ADMIN_PASSWORD=admin123/ADMIN_PASSWORD=$ADMIN_PASS/" .env
        sed -i "s/API_KEYS=sk-proxy-demo-key-123/API_KEYS=$API_KEY/" .env
        log "Admin password: $ADMIN_PASS"
        log "API Key: $API_KEY"
        echo ""
        warn "SAVE THESE CREDENTIALS! They won't be shown again."
        echo ""
    fi

    log "Setup complete! Run './deploy.sh up' to start the service."
}

# ============================================================
# SSL: Setup Let's Encrypt certificate
# ============================================================
setup_ssl() {
    DOMAIN=$1
    if [ -z "$DOMAIN" ]; then
        err "Usage: ./deploy.sh ssl your-domain.com"
    fi

    if [ "$EUID" -ne 0 ]; then
        err "Please run as root: sudo ./deploy.sh ssl $DOMAIN"
    fi

    log "Installing certbot..."
    apt-get install -y certbot 2>/dev/null || yum install -y certbot 2>/dev/null

    log "Stopping nginx temporarily..."
    docker compose stop nginx 2>/dev/null || true

    log "Obtaining SSL certificate for $DOMAIN..."
    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos --email admin@"$DOMAIN"

    log "Copying certificates..."
    cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem nginx/ssl/cert.pem
    cp /etc/letsencrypt/live/$DOMAIN/privkey.pem nginx/ssl/key.pem

    log "Updating nginx config with domain..."
    sed -i "s/server_name _;/server_name $DOMAIN;/" nginx/nginx.conf

    log "Restarting nginx..."
    docker compose start nginx

    log "SSL certificate installed for $DOMAIN"

    # Setup auto-renewal
    log "Setting up auto-renewal..."
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $PROJECT_DIR/nginx/ssl/cert.pem && cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $PROJECT_DIR/nginx/ssl/key.pem && docker compose restart nginx") | crontab -
    log "Auto-renewal configured"
}

# ============================================================
# Start services
# ============================================================
start() {
    echo -e "${CYAN}Starting LLM API Relay...${NC}"
    docker compose up -d --build
    sleep 3

    # Check health
    if docker compose ps | grep -q "healthy"; then
        log "Service started successfully!"
    else
        warn "Service started but health check pending..."
    fi

    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}  Service Information${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo -e "  Dashboard: ${GREEN}http://$(hostname -I | awk '{print $1}')${NC}"
    echo -e "  API Endpoint: ${GREEN}http://$(hostname -I | awk '{print $1}')/v1/chat/completions${NC}"
    echo -e "  Admin Password: ${YELLOW}$(grep ADMIN_PASSWORD .env | cut -d= -f2)${NC}"
    echo -e "  API Key: ${YELLOW}$(grep API_KEYS .env | cut -d= -f2)${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

# ============================================================
# Stop services
# ============================================================
stop() {
    log "Stopping services..."
    docker compose down
    log "Services stopped"
}

# ============================================================
# Restart services
# ============================================================
restart() {
    log "Restarting services..."
    docker compose restart
    log "Services restarted"
}

# ============================================================
# View logs
# ============================================================
logs() {
    docker compose logs -f --tail=100
}

# ============================================================
# Show status
# ============================================================
status() {
    echo -e "${CYAN}Service Status:${NC}"
    docker compose ps
    echo ""
    echo -e "${CYAN}Health Check:${NC}"
    curl -s http://localhost/health 2>/dev/null | head -5 || echo "Service not responding"
}

# ============================================================
# Update and restart
# ============================================================
update() {
    log "Pulling latest changes and rebuilding..."
    docker compose up -d --build --force-recreate
    log "Update complete"
}

# ============================================================
# Backup data
# ============================================================
backup() {
    BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).tar.gz"
    tar -czf "$BACKUP_FILE" data/ .env nginx/ssl/
    log "Backup created: $BACKUP_FILE"
}

# ============================================================
# Show credentials
# ============================================================
creds() {
    echo -e "${CYAN}Current Credentials:${NC}"
    echo -e "  Admin Password: ${YELLOW}$(grep ADMIN_PASSWORD .env | cut -d= -f2)${NC}"
    echo -e "  API Key: ${YELLOW}$(grep API_KEYS .env | cut -d= -f2)${NC}"
}

# ============================================================
# Main
# ============================================================
case "${1:-help}" in
    setup)   setup ;;
    ssl)     setup_ssl "$2" ;;
    up)      start ;;
    down)    stop ;;
    restart) restart ;;
    logs)    logs ;;
    status)  status ;;
    update)  update ;;
    backup)  backup ;;
    creds)   creds ;;
    *)
        echo ""
        echo -e "${CYAN}LLM API Relay - Deployment Script${NC}"
        echo ""
        echo "Usage: ./deploy.sh <command>"
        echo ""
        echo "Commands:"
        echo "  setup     - Install Docker, generate SSL, configure firewall"
        echo "  ssl <dom> - Setup Let's Encrypt SSL for domain"
        echo "  up        - Start services"
        echo "  down      - Stop services"
        echo "  restart   - Restart services"
        echo "  logs      - View live logs"
        echo "  status    - Show service status"
        echo "  update    - Rebuild and restart"
        echo "  backup    - Backup data and config"
        echo "  creds     - Show current credentials"
        echo ""
        ;;
esac
