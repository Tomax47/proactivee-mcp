FROM node:22-alpine AS build
WORKDIR /app
COPY package.json yarn.lock tsconfig.json ./
RUN yarn install --frozen-lockfile --ignore-scripts
COPY src ./src
RUN yarn tsc

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts && yarn cache clean
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
CMD ["node", "build/http.js"]
