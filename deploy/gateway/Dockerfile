FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY gateway.mjs ./gateway.mjs
USER node
EXPOSE 8080
CMD ["node", "gateway.mjs"]
