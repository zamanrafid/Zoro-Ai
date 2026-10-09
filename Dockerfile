# ZORO AI — self-host with Docker (recommended for real use: FFmpeg included,
# no function timeouts, files persist in a volume).
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["npm", "start"]
