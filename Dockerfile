FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    git \
    curl \
    bash

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
