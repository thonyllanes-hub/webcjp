FROM ghcr.io/puppeteer/puppeteer:latest

USER root
WORKDIR /app

# Copy and change ownership
COPY --chown=pptruser:pptruser package*.json ./

# Switch to the non-root user
USER pptruser

# Install dependencies (skipping chromium download)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

RUN npm install

# Copy all application code
COPY --chown=pptruser:pptruser . .

EXPOSE 3000
CMD ["npm", "start"]
