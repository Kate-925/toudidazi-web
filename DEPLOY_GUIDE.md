# offer · 投递搭子 — 上线部署指南

本部署包为**零第三方依赖**的 Node.js 18+ 前后端一体包，完整保留了 `v28` 的所有提示词与功能，并完成了上线必需的安全与变现改造：
1. **API Key 服务端隔离**：阿里云百炼 Key 仅存在服务端环境变量中，彻底防止前端 F12 盗刷。
2. **免费体验 + 兑换码（卡密）系统**：支持按「浏览器设备 ID + IP」双重限制免费体验次数（截图/图片识别不额外扣次）；用完后自动弹出兑换码窗口，输入卡密立即解锁。

---

## 上线前 1 分钟必改项

1. 打开 `public/index.html`，搜索 `【上线前可修改】`，将兑换码弹窗里的引导文案改成你自己的小红书号或微信号。
2. 准备好你的阿里云百炼 API Key（`DASHSCOPE_API_KEY`）以及想售卖的兑换码列表（`REDEEM_CODES`，例如 `XHS01:10,XHS02:20`）。

---

## 部署方式一：阿里云函数计算 FC（推荐·国内直连、按量极低成本、免买服务器）

1. 登录 **阿里云函数计算 FC 控制台** → 创建函数 → 选择 **Web 函数**（运行环境选 **Node.js 18** 或 **Node.js 20**）。
2. 代码上传方式选「通过文件夹/ZIP 上传」，直接上传本压缩包解压后的全部文件。
3. 启动命令填：`node server.js`，监听端口填：`9000`。
4. 在函数的 **配置 → 环境变量** 中添加：
   - `DASHSCOPE_API_KEY` = `你的百炼 API Key`
   - `TEXT_MODEL` = `qwen-plus`（或 `qwen-max` / `qwen4-max`）
   - `VISION_MODEL` = `qwen-vl-ocr`
   - `FREE_TRIAL_COUNT` = `3`（或 `1`）
   - `REDEEM_CODES` = `OFFER2026:10,VIP888:50`
5. 在 **触发器 / 自定义域名** 中绑定你已备案的域名，即可直接上线访问！

> **如果你希望前端放阿里云 OSS + 后端放函数计算 FC**：
> - 把 `public/index.html` 里的 `const API_BASE = ...` 改为你的函数计算后端域名（如 `https://api.你的域名.com`）。
> - 将 `public/index.html` 上传至 OSS 静态网站托管即可，后端已自带完整 CORS 跨域支持。

---

## 部署方式二：阿里云轻量应用服务器 / ECS（或本机测试）

```bash
# 1. 解压后进入目录（需 Node.js >= 18）
cd toudidazi-deploy

# 2. 配置环境变量并启动
export DASHSCOPE_API_KEY="sk-你的百炼Key"
export FREE_TRIAL_COUNT="3"
export REDEEM_CODES="OFFER2026:10,VIP888:50"
node server.js
```
启动后访问 `http://服务器IP:9000`（生产环境建议配合 Nginx 或 Caddy 挂上 HTTPS 域名，并用 `pm2 start server.js --name toudidazi` 守护进程）。

---

## 部署方式三：Vercel 一键免费测试（无需备案、3 分钟预览）

1. 将本目录推送到 GitHub 仓库，在 [Vercel](https://vercel.com) 中点击 **Import Project**。
2. 在 Vercel 项目 **Settings → Environment Variables** 中填入 `DASHSCOPE_API_KEY`、`FREE_TRIAL_COUNT`、`REDEEM_CODES`。
3. 点击 **Deploy** 即可获得 HTTPS 网址（注意：Vercel 免费版域名在国内部分网络可能偏慢，正式面向小红书推广建议用方案一阿里云函数计算 FC）。
