FROM ghcr.io/puppeteer/puppeteer:latest

# Cambiar a usuario root temporalmente si necesitas instalar cosas extra (usualmente no necesario)
# USER root

# Copiar archivos
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD ["npm", "start"]
