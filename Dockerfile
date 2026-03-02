FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install Playwright Chromium and its OS-level dependencies
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Root dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Webapp dependencies
COPY webapp/package.json webapp/package-lock.json webapp/
RUN cd webapp && npm ci

# Copy source and build webapp
COPY . .
RUN cd webapp && npm run build

# Cloud Run injects PORT env var; default to 3000 for local Docker usage
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
