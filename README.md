# Veil Notes 云端部署说明

Veil Notes 支持两种运行方式：

- 云端浏览器模式：Next.js + PostgreSQL，适合部署到服务器后通过浏览器访问。
- 桌面本地仓库模式：Electron + Markdown 文件 + SQLite 索引，适合本机离线使用。

本文重点说明云端生产部署。

## 云端生产能力

当前云端模式已具备上线所需的基础设施：

- PostgreSQL 持久化存储，覆盖用户、笔记本、笔记、回收站和同步接口。
- 显式数据库迁移脚本：`pnpm run migrate`。
- 生产环境变量检查：`pnpm run env:check`。
- 健康检查接口：`GET /api/health`。
- 真实数据库集成检查：`pnpm run db:check`。
- httpOnly 会话 Cookie、多设备会话记录、CSRF 校验、登录/注册同源校验。
- 登录、注册和修改密码写入认证事件日志，便于生产排查账号风险。
- 登录失败达到阈值后会基于数据库认证事件进行账号锁定，多实例部署共享同一策略。
- 设置页可查看当前登录设备，并撤销其他设备会话。
- 登录后可在设置页修改密码，修改后会撤销所有旧会话并刷新当前会话。
- 生产默认关闭公开注册，可用脚本创建初始账号，也可用管理员脚本重置密码。
- 登录、注册、修改密码和会话撤销使用数据库共享限流，支持来源和账号维度，多实例部署共享同一策略。
- 服务端富文本 HTML 白名单清洗。
- 笔记列表支持服务端分页、全文搜索索引、标签/笔记本/收藏/日期过滤，避免大工作区首屏全量加载。
- 标签管理使用服务端聚合统计。
- 图片和常见文件附件上传、用量配额、列表查询、鉴权读取和删除，编辑器可直接插入本地图片或附件链接。
- 设置页提供文件存储管理入口，可查看占用、复制链接、打开预览/下载和删除文件。
- 笔记版本号、内容哈希和 `baseVersion` 乐观锁，避免多端保存静默覆盖。
- 保存冲突时会加载服务器最新版本，并尽量把本地修改保留为冲突副本。
- `/api/sync` 支持 `version/baseVersion/contentHash` 冲突检测。
- 请求会返回 `X-Request-Id` 并输出结构化 JSON 访问日志，便于生产排查。
- 安全响应头和生产 CSP/HSTS。
- Dockerfile、docker-compose 和 Nginx 反向代理示例。

## 环境变量

复制模板并按实际服务器修改：

```bash
cp .env.example .env
```

关键变量：

```env
APP_ORIGIN=https://notes.example.com
DATABASE_URL=postgres://veil:strong_password@localhost:5432/veil_notes
DATABASE_POOL_SIZE=10
DATABASE_SSL=disable
VEIL_ALLOW_REGISTRATION=false
VEIL_SEED_SAMPLE_NOTES=false
VEIL_AUTH_LOCKOUT_FAILURES=10
VEIL_AUTH_LOCKOUT_WINDOW_MINUTES=15
VEIL_AUTH_LOCKOUT_DURATION_MINUTES=15
VEIL_UPLOAD_DIR=/var/lib/veil-notes/uploads
VEIL_MAX_UPLOAD_BYTES=10485760
VEIL_ASSET_QUOTA_BYTES=1073741824
VEIL_ORPHAN_ASSET_GRACE_DAYS=7
```

说明：

- `APP_ORIGIN` 必须是浏览器访问该应用的真实 Origin，用于同源校验；生产环境必须是 HTTPS 且不能带路径，例如 `https://notes.example.com`。
- 托管 PostgreSQL 如果要求 TLS，设置 `DATABASE_SSL=require`。
- 生产环境默认关闭公开注册。需要开放注册时显式设置 `VEIL_ALLOW_REGISTRATION=true`。
- 生产环境默认不写入演示笔记。需要演示数据时设置 `VEIL_SEED_SAMPLE_NOTES=true`。
- `VEIL_AUTH_LOCKOUT_FAILURES`、`VEIL_AUTH_LOCKOUT_WINDOW_MINUTES`、`VEIL_AUTH_LOCKOUT_DURATION_MINUTES` 控制登录失败锁定策略，默认 15 分钟内失败 10 次后锁定 15 分钟。
- `VEIL_UPLOAD_DIR` 保存上传文件，生产环境必须配置为绝对路径，并放在持久化磁盘或挂载卷上。
- `VEIL_MAX_UPLOAD_BYTES` 限制单个上传文件大小，默认 `10485760` 即 10MB；反向代理的 `client_max_body_size` 也要不小于该值。
- `VEIL_ASSET_QUOTA_BYTES` 限制单个用户的文件总空间，默认 `1073741824` 即 1GB。
- `VEIL_ORPHAN_ASSET_GRACE_DAYS` 是孤儿文件清理脚本的默认宽限天数，默认 7 天。

## 直接部署

服务器要求：

- Node.js 22 LTS 或兼容版本。
- pnpm 10。
- PostgreSQL 14+。
- HTTPS 反向代理。

安装依赖、迁移数据库、构建：

```bash
pnpm install --frozen-lockfile
pnpm run env:check
pnpm run migrate
pnpm run build
pnpm run standalone:prepare
```

创建首个账号：

```bash
VEIL_ADMIN_USERNAME=admin VEIL_ADMIN_PASSWORD='change-this-long-password' pnpm run user:create
```

重置账号密码：

```bash
VEIL_RESET_USERNAME=admin VEIL_RESET_PASSWORD='new-long-password' pnpm run password:reset
```

启动服务：

```bash
NODE_ENV=production pnpm run start:cloud
```

健康检查：

```bash
curl -f https://notes.example.com/api/health
```

数据库集成检查：

```bash
pnpm run db:check
```

浏览器访问：

```txt
https://notes.example.com
```

部署后验收：

```bash
VEIL_SMOKE_BASE_URL=https://notes.example.com \
VEIL_SMOKE_USERNAME=admin \
VEIL_SMOKE_PASSWORD='change-this-long-password' \
pnpm run smoke:cloud
```

建议使用专门的 smoke 测试账号。脚本会验证健康检查、登录、会话管理、CSRF 拦截、笔记创建/更新/读取/删除、文件上传/删除；默认会把测试笔记软删除到回收站，不会清空回收站。若部署环境暂未挂载上传目录，可加 `VEIL_SMOKE_SKIP_UPLOAD=true` 跳过上传检查。
如果脚本从容器内或内网地址访问服务，但生产 `APP_ORIGIN` 是外部 HTTPS 域名，请额外设置 `VEIL_SMOKE_ORIGIN=https://notes.example.com`。

## Docker Compose 部署

准备 `.env`：

```env
APP_ORIGIN=https://notes.example.com
POSTGRES_PASSWORD=change-this-postgres-password
DATABASE_POOL_SIZE=10
VEIL_ALLOW_REGISTRATION=false
VEIL_SEED_SAMPLE_NOTES=false
VEIL_AUTH_LOCKOUT_FAILURES=10
VEIL_AUTH_LOCKOUT_WINDOW_MINUTES=15
VEIL_AUTH_LOCKOUT_DURATION_MINUTES=15
VEIL_MAX_UPLOAD_BYTES=10485760
VEIL_ASSET_QUOTA_BYTES=1073741824
VEIL_ORPHAN_ASSET_GRACE_DAYS=7
```

启动：

```bash
docker compose up -d --build
```

创建首个账号：

```bash
docker compose exec app env VEIL_ADMIN_USERNAME=admin VEIL_ADMIN_PASSWORD='change-this-long-password' node scripts/create-user.mjs
```

健康检查：

```bash
curl -f http://127.0.0.1:3000/api/health
```

部署后验收：

```bash
docker compose exec app env \
  VEIL_SMOKE_BASE_URL=http://127.0.0.1:3000 \
  VEIL_SMOKE_ORIGIN=https://notes.example.com \
  VEIL_SMOKE_USERNAME=admin \
  VEIL_SMOKE_PASSWORD='change-this-long-password' \
  node scripts/cloud-smoke.mjs
```

`deploy/nginx.conf` 提供了 Nginx HTTPS 反向代理示例。部署时替换域名和证书路径，并把 `APP_ORIGIN` 配成外部 HTTPS Origin。
如果调整 `VEIL_MAX_UPLOAD_BYTES`，请同步调整 Nginx `client_max_body_size`。
Docker Compose 已将 `/app/uploads` 挂载为 `uploads-data` 持久卷；应用容器以非 root 用户运行。如果改用宿主机目录，请保留 `VEIL_UPLOAD_DIR` 与挂载路径一致，并确保该目录对容器内 `node` 用户可写。

## 资产清理

文件上传后会记录到 `assets` 表。用户删除单个文件时会同步移除磁盘文件和数据库记录；如果上传后没有插入任何笔记，可以用清理脚本找出孤儿文件。

先 dry-run：

```bash
pnpm run assets:cleanup
```

确认候选项后执行：

```bash
pnpm run assets:cleanup -- --execute
```

可通过 `--grace-days 14` 调整宽限期，或通过 `--limit 1000` 调整单次处理上限。

## 质量门禁

上线前执行：

```bash
pnpm run lint
pnpm run test
npx tsc --noEmit
pnpm run build
```

或者：

```bash
pnpm run deploy:check
```

部署到服务器并创建测试账号后执行：

```bash
pnpm run smoke:cloud
```
真实数据库检查：

```bash
pnpm run db:check
```

## 桌面本地模式

桌面端仍使用本地仓库，默认写入：

```txt
~/Documents/Veil Notes
```

开发模式：

```bash
pnpm run dev:app
```

打包 macOS 目录版：

```bash
pnpm run app:build
```

## 已知后续增强

- 同步冲突当前返回冲突 ID；普通编辑保存已支持冲突副本，后续可增加可视化合并界面。
- 生产风控可继续扩展管理员审计面板和更细粒度的告警。
