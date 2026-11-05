FROM node:22-bookworm

WORKDIR /opt/supersplat
COPY package.json package-lock.json ./
RUN npm ci

# Build this checkout, including the custom view-dependent SH renderer.
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "serve", "--", "--listen", "tcp://0.0.0.0:3000"]
