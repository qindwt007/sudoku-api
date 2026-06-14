FROM node:18-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装生产依赖
RUN npm install --omit=dev

# 复制源代码
COPY . .

# 云托管默认监听 8080
EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "src/app.js"]
