# ==========================================
# 🤗 DOCKERFILE - HUGGING FACE SPACES
# Deploy Discord Bot con 2GB RAM GRATIS
# ==========================================

FROM node:18-slim

# Metadata
LABEL maintainer="Discord Bot"
LABEL description="Discord Bot System on Hugging Face Spaces"

# Working directory
WORKDIR /app

# Installa dipendenze di sistema (se servono)
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia package files
COPY package*.json ./

# Installa dipendenze Node.js (solo production)
RUN npm ci --only=production && npm cache clean --force

# Copia tutto il codice
COPY . .

# Hugging Face usa porta 7860 di default
EXPOSE 7860

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:7860', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Avvia bot
CMD ["node", "app.js"]
