# 示例交易导航：给朋友的源码与部署说明

这份源码包含首页、行情页、访问采集、请求日志和密码保护的管理后台。前台是 HTML/CSS/JavaScript；部署目标是 Cloudflare Pages Functions，使用 D1 保存访问和请求，KV 缓存待写入访问与登录限流，另有定时 Worker 做归档和清理。

## 包里保留了什么

- **8 个交易所注册链接及展示的返佣比例保留原样**，是 Thomas 的链接。不要把它们误改成自己的，也不要把这些链接当作朋友的返佣账户。
- 首页已配置微信号、Telegram 二维码和 X 主页。微信号可直接复制，Telegram 二维码位于 `assets/icons/contact-telegram-qr.png`。
- Binance 行情卡片跳向其公开交易页面，不带本站返佣参数；行情接口使用 Binance 公开接口。
- 没有原站 D1/KV 数据、访问/IP 记录、历史统计、管理员密码、Cloudflare 资源 ID 或账户凭据。数据库脚本只有空表结构。每个新站从零开始累计自己的数据。

## 后台数据只属于朋友的站点

朋友的后台数据来自**朋友自己新建的 D1 和 KV**。部署时将 Pages 与定时 Worker 都绑定到这两个新资源，并把代码里的 `example.com` 只替换成朋友自己的域名。后台的“本站全部”只汇总这个新 D1 中的记录；包内没有 Thomas 的历史数据。朋友单独生成后台密码及会话密钥，Thomas 的登录状态不能用于朋友的后台。保留的交易所注册链接只是访客点击后的外部跳转，不会让朋友后台读取 Thomas 的统计。

若把 D1/KV 错绑到其他站点，隔离就不成立；上线前必须在两个 `wrangler.jsonc` 中核对资源 ID 与朋友 Cloudflare 控制台中**新建的**资源完全一致。不要导入任何旧站备份。

## 用自己的 Cloudflare 账号部署

在电脑上安装 Node.js，在解压后的源码根目录打开终端。运行以下命令，在浏览器里选择自己的 Cloudflare 账号并授权 Wrangler，再确认终端显示的是你准备部署的账号。

```bash
npx wrangler login
npx wrangler whoami
```

如果终端已经登录其他账号，先运行 `npx wrangler logout` 再登录。网站的 `/admin.html` 使用第 4 步生成的后台密码，Cloudflare 登录用于管理和部署项目。

1. 解压后先在自己的 Cloudflare 账号创建 **Pages 项目、D1 数据库和 KV 命名空间**。将 `wrangler.jsonc` 与 `worker/wrangler.jsonc` 中的 `friend-site` 项目名、`REPLACE_WITH_YOUR_D1_DATABASE_ID`、`REPLACE_WITH_YOUR_KV_NAMESPACE_ID` 换成自己新建资源的值。`PYY_REQUEST_AUDIT_DB` 和 `PYY_VISIT_BUFFER` 是代码所需的绑定名称，可以保留；资源 ID 必须是朋友自己的。
2. 全局查找 `example.com`，换成朋友实际使用的域名。若暂时只用 Pages 提供的 `*.pages.dev` 域名，就先填这个完整主机名；后台只接受源码允许列表中的域名。主要位置是 `api/_lib/visitor-store.js`、`api/_lib/request-audit.js`、`functions/_middleware.js`、`admin.html` 和各页面页脚。
3. 在朋友自己的 D1 上，按以下顺序执行空表脚本：`scripts/visit-d1-schema.sql`、`scripts/request-audit-schema.sql`、`scripts/request-audit-triggers.sql`、`scripts/request-legacy-schema.sql`、`scripts/ip-research-schema.sql`。可在 D1 控制台 SQL 编辑器执行；命令行方式为 `npx wrangler d1 execute friend-site-db --remote --file scripts/文件名.sql`，每个文件执行一次。切勿指向 Thomas 的 D1。
4. 在自己电脑的私密终端运行 `node scripts/generate-admin-secrets.mjs`。脚本每次随机生成一组**新的后台登录密码、密码哈希、会话密钥**。把登录密码保存到自己的密码管理器。将输出的 `PYY_ADMIN_PASSWORD_HASH` 和 `PYY_ADMIN_SESSION_SECRET` 分别放入 Pages 项目的 **Settings → Variables and Secrets**，选择加密保存。`PYY_IP_RETENTION_DAYS=90` 已在 `wrangler.jsonc` 的普通变量中。不要把明文密码、哈希或会话密钥写进源码、Git 或聊天。
5. 在源码根目录运行 `npm run build`，然后用 Wrangler 部署 Pages：`npx wrangler pages deploy dist --project-name friend-site`（项目名换成第 1 步的名称）。**需要使用 Wrangler 或 Git 构建部署包含 Functions 的项目；仅把 `dist` 拖到网页上传，不会部署后台 Functions。**
6. 配好 `worker/wrangler.jsonc` 中相同的 D1/KV 绑定后，运行 `npx wrangler deploy --config worker/wrangler.jsonc` 部署定时归档 Worker。其定时任务负责归档访问并清理过期记录。

Cloudflare 官方参考：[Pages Functions 部署](https://developers.cloudflare.com/pages/functions/get-started/)、[Pages 绑定和加密变量](https://developers.cloudflare.com/pages/functions/bindings/)、[D1 命令](https://developers.cloudflare.com/d1/wrangler-commands/)、[Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。

## 后台登录和密码怎样工作

- 后台入口是 `https://朋友的域名/admin.html`。这套代码只有**一个管理员密码**，没有公开注册、找回密码或朋友之间共用账号的功能。
- 明文密码只在登录时输入；服务端读取 `PYY_ADMIN_PASSWORD_HASH`，用随机盐和 PBKDF2-SHA256（100,000 次）校验。哈希存在朋友自己 Cloudflare 的加密变量中，不写在网页里。
- 登录成功后发放 HMAC 签名的 `HttpOnly`、`Secure`、`SameSite=Strict` Cookie，有效期 12 小时；退出会清除 Cookie。后台数据 API 每次检查登录状态。登录接口按 IP 在 15 分钟窗口内限制尝试次数；需要 D1，KV 作回退缓存。
- 换密码时重新运行生成脚本，把两项加密变量一起更新并重新部署。更新会话密钥后，旧登录状态立即失效。没有密码找回接口；遗失后由 Cloudflare 项目所有者重置。

## 验收

在朋友的域名上检查：首页和行情页能打开；交易所卡片跳转目标仍是 Thomas 的 8 个链接；三个联系入口已换成朋友自己的；未登录访问后台数据得到 401；用新密码登录成功；首次统计为 0 次访问、0 个 IP（访问首页后会产生朋友自己的新记录）；尝试查询非朋友域名被拒绝。若后台报“尚未完成配置”或数据库未连接，先检查 Pages 的两个加密变量及 D1/KV 绑定。

`FRIEND_PROMPTS.md` 提供可直接交给编码助手的部署、联系方式修改和验收提示词。请让助手只使用朋友自己的 Cloudflare 账号与资源。
