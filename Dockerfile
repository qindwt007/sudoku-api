FROM node:18-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装生产依赖
RUN npm install --omit=dev

# 复制源代码
COPY . .

# 抖音云模板部署默认监听 8000
EXPOSE 8000

ENV NODE_ENV=production
ENV PORT=8000

CMD ["node", "src/app.js"]
