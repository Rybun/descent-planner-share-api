FROM node:20-alpine
WORKDIR /app
COPY src/package*.json ./
RUN npm install --omit=dev
COPY src/index.js ./
EXPOSE 3015
CMD ["node", "index.js"]
