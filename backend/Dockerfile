FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 3001

CMD ["npm", "start"]