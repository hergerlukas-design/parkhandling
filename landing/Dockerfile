# Landingpage Park & Fly – Build-Kontext ist NUR landing/ (fly deploy aus diesem Ordner)
# --- Build ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Öffentliche Supabase-Werte kommen aus der eingecheckten landing/.env
RUN npm run build

# --- Auslieferung (nur statische Dateien) ---
FROM nginx:1.27-alpine
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
