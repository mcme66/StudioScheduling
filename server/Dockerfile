FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

# Run pending migrations, then start the API.
CMD ["sh", "-c", "npm run migrate:up && node src/index.js"]
