# 腾讯云 Ubuntu 部署

目标实例：`lhins-rb348nyj`，公网 IP：`119.91.63.248`。服务器原有 `/opt/sub2api` 项目，占用回环地址 8080，并使用现有 Nginx 提供 HTTPS。

本项目使用 `/opt/xinzhan-lab` 和回环端口 4173。服务器 Docker Hub 拉取超时，实际采用官方 Node.js v24.22.1 独立运行包及 `xinzhan-lab.service`；数据库为 `/var/lib/xinzhan-lab/lab.sqlite`，备份在同目录 `backups/`。服务使用独立无登录权限的系统用户 `xinzhan-lab`。不要修改 Sub2API 的容器、数据库或环境文件。

服务管理：`sudo systemctl status xinzhan-lab`、`sudo systemctl restart xinzhan-lab`，日志为 `sudo journalctl -u xinzhan-lab`。手动备份：

```sh
sudo -u xinzhan-lab env DATABASE_PATH=/var/lib/xinzhan-lab/lab.sqlite /opt/xinzhan-lab/runtime/bin/node /opt/xinzhan-lab/server/admin.mjs backup
```

`deploy/xinzhan-lab.service` 是本服务器使用的 systemd 配置。下面 Docker Compose 是可选部署方案，不是本服务器实际运行方式。

## 与现有 Sub2API 共存

本机已具备 Nginx 和有效 IP HTTPS 证书，因此不启动本仓库的 Caddy 服务，避免占用已有的 80/443。项目 `.env` 使用：

```dotenv
NODE_ENV=production
PUBLIC_ORIGIN=https://119.91.63.248
APP_BASE_PATH=/lab/
```

在现有 HTTPS server 块中仅增加 `include /opt/xinzhan-lab/deploy/nginx-lab.conf;`，新入口为 `https://119.91.63.248/lab/`。前端使用相对 API 地址，自动请求 `/lab/api/`，不会调用 Sub2API 的 `/api/`。Cookie 名为 `lab_session` 且范围限定 `/lab/`。

修改前先备份原 Nginx 配置，执行 `nginx -t` 通过后仅 reload，不重启原项目。当前部署升级时先手动备份数据库，再更新 `/opt/xinzhan-lab` 下的应用代码（保留 `.env` 和 `runtime/`），最后执行 `sudo systemctl restart xinzhan-lab` 并检查公网健康接口。回滚时移除该 include、验证并 reload 即可，独立数据库保留。

当前服务器备份恢复时，先停止 `xinzhan-lab`，保留原数据库及 WAL/SHM 副本，再以完整性检查通过的备份替换数据库并移开旧 WAL/SHM，设置属主 `xinzhan-lab:xinzhan-lab`、权限 600，重新启动并验收。不要在运行中直接覆盖数据库文件。

以下是另一种可选的 Docker 首次安装方案；不适用于当前 systemd 部署的日常更新。已有 Nginx 的本服务器不要启动 `public` profile。

## 安装与首次初始化

服务器需要 Docker Engine 和 Compose 插件。上传本项目的 `server/`、`src/`、`deploy/`、`index.html`、`package.json`、`Dockerfile`、`.dockerignore`、`compose.yaml`；不要上传本地 `.env`、`.cache/`、测试数据库或私钥。

在服务器项目目录执行：

```sh
docker compose build
docker compose run --rm app node server/admin.mjs
docker compose up -d app
docker compose ps
curl --fail http://127.0.0.1:4173/api/health
```

初始化仅创建一个 `teacher` 老师账号，并在终端显示随机初始密码一次。保存到自己的密码管理器，首次登录后在个人中心修改。已有数据库再次初始化会拒绝执行。学生和其他老师由老师在“成员管理”创建，不启用原演示账号。

数据库及每日备份存放在 `lab_data` Docker 持久卷的 `/app/data/`。更新镜像或重建容器保留数据；**不要执行 `docker compose down -v`**，该命令会删除持久卷。

## 没有域名时先通过 SSH 验收

默认只在服务器回环地址开放应用，不把账号密码通过公网 HTTP 传输。电脑执行（替换实际 SSH 用户名）：

```sh
ssh -L 4173:127.0.0.1:4173 <SSH用户>@119.91.63.248
```

电脑浏览器打开 `http://127.0.0.1:4173`；请求经 SSH 加密通道抵达云端数据库。此时只有有 SSH 通道的人能访问，尚不是老师学生直接访问的公网入口。

## 正式 HTTPS 访问

准备指向该 IP 的域名，并满足腾讯云对该域名的接入要求。在项目 `.env` 中填写：

```dotenv
DOMAIN=lab.example.com
PUBLIC_ORIGIN=https://lab.example.com
NODE_ENV=production
```

`lab.example.com` 必须替换为自己的域名。确认服务器和腾讯云防火墙允许 TCP 80、443（数据库和 4173 不对公网开放），然后：

```sh
docker compose --profile public up -d
```

Caddy 负责申请 HTTPS 证书和反向代理。生产配置只接受 HTTPS 公共地址，登录 Cookie 使用 Secure、HttpOnly、SameSite=Strict。先验证证书和 `/api/health`，再创建真实成员账号。

## 备份、恢复与升级

服务每次启动及每 24 小时备份一次 SQLite，并对备份执行完整性检查。离线过久不会补做漏掉的每日备份。备份与主库目前在同一台机器，需定期复制到你控制的另一台设备；目前不自动清理旧备份，应检查磁盘容量。

```sh
docker compose exec app node server/admin.mjs backup
docker compose cp app:/app/data/backups ./server-backups
```

`server-backups` 含真实成员数据和密码哈希，应妥善保护。恢复前停止 `app`，保留原主库及 `-wal`、`-shm` 文件副本，再用通过完整性检查的备份替换主库，移开旧的 WAL/SHM，确保属主为容器的 UID 1000。恢复后删除 sessions 表中的会话，让成员重新登录，再检查账号、借用占用和请假记录。不要把备份放到公开网站目录。

升级前手动备份，然后执行 `docker compose build app` 和 `docker compose up -d app`。正式 HTTPS 配置使用 `docker compose --profile public up -d`。验收包括：两台设备登录同一账号、老师创建学生并登录、重启后记录仍在、学生不能创建老师或审批自己、同时发放同一设备仅一单成功。

## 当前架构边界

适用于单实验室、单服务器部署。SQLite 使用 WAL 和 `BEGIN IMMEDIATE`，每笔变更在事务中读取最新工作空间、校验并写入；业务快照保存在一条 JSON 记录，凭据、会话及登录限流独立建表。多台应用服务器或大规模数据需要迁移为关系模型和共享数据库，不能直接复制多个 SQLite 文件。
