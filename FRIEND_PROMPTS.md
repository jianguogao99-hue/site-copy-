# 给朋友的提示词

把这个 ZIP 解压后，将下面的提示词和源码目录一起交给你的编码助手。所有 Cloudflare 操作都使用**你自己的账号**。密码只在你的本地终端和 Cloudflare 加密变量中处理，不发到聊天。

## 提示词 1：检查并部署

> 请先阅读本源码包的 README.md，检查项目结构和配置。网站使用 Cloudflare Pages Functions、D1、KV 和定时 Worker。我要在自己的 Cloudflare 账号下新建独立站点与全新的空 D1/KV，不能连接、导入或复制 Thomas 的数据、账号、Cloudflare 资源 ID 或后台密码。请把 example.com、friend-site、D1/KV 占位 ID 换成我提供的域名和我新建资源的值。Pages 与 Worker 必须绑定同一组由我新建的 D1/KV；后台只读取这个 D1 中我站点产生的新记录，域名允许列表只能包含我的域名。按 README 顺序建空表、构建并部署 Pages 与定时 Worker。交易所的 8 个注册链接及返佣展示保持源码原样，它们属于 Thomas。完成后检查 Pages Functions 真正上线、首页可访问、未登录后台 API 返回 401、后台用我自己生成的密码能登录、数据库起初没有旧访问/IP 记录，查询其他域名被拒绝。请列出实际修改的文件、部署地址和每项验收结果；无法验证的项目明确标出来。

## 提示词 2：只改我的联系方式

> 请更新 `index.html` 中显示的微信号和 X 主页链接，并用我提供的新二维码替换 `assets/icons/contact-telegram-qr.png`。更新后检查微信复制按钮、Telegram 二维码弹层和 X 链接。

## 提示词 3：后台密码与上线验收

> 请按 README 说明检查后台登录配置。让我在自己的电脑上运行 scripts/generate-admin-secrets.mjs，并把明文密码存入我的密码管理器。你只需要告诉我把 PYY_ADMIN_PASSWORD_HASH 和 PYY_ADMIN_SESSION_SECRET 设置到我自己的 Cloudflare Pages 加密变量中；不要索取、打印或记录这三个值。部署后验证：未登录读后台数据为 401；正确密码可登录；错误密码被拒绝；退出后会话失效；统计只包含我新站产生的新数据。核对 D1/KV 绑定都指向我的资源，并说明还有什么未完成。

## 提供给助手的资料

- 你的域名或 Pages 的完整 `*.pages.dev` 主机名。
- 你自己 Cloudflare 新建的 Pages 项目名、D1 数据库名与 ID、KV 命名空间 ID。
- 你自己的微信、X、Telegram 联系方式（仅在需要更新时提供）。

不要提供 Thomas 的 Cloudflare 登录、D1/KV ID、原站数据库备份或后台密码。
