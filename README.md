# Re:代码生活

React + Vite 个人记录网站。Supabase 提供账号、数据库和私有图片存储，Netlify 发布前端。

## 本次实现

- 首页字体由 25,575,676 字节的完整 TTF 改为 13,820 字节的 WOFF2 子集；完整原文件保留在 `resources/fonts/`，不进入网站发布目录。
- 账号页显示当前邮箱，支持仅退出当前设备；登录后返回原页面，会话变化同步到其他标签页，退出时保留本机文字草稿。
- 数据备份页可导出 JSON，或导出包含封面的 ZIP；可选择包含回收站，按云端分页读取，不受列表已加载条数限制。
- Markdown 写作与预览，支持标题、列表、表格、任务列表、链接、图片和代码高亮；正文与备份组件按需加载。
- 首页记录框可滚动浏览，每批读取 12 条，接近底部时自动加载更多；记录列表、搜索、管理、回收站和封面清理各有独立页面。
- 详情页用于阅读，通过“管理记录”进入编辑、删除或恢复操作；搜索条件随返回链接保留。
- 左侧正方形封面、右侧标题和标签的可滚动记录卡片。
- 按标题搜索、按标签筛选；每批读取 12 条，使用创建时间和记录编号作为分页游标。
- 新增、编辑、回收站、恢复和确认后彻底删除。
- 保存携带固定操作编号，响应丢失后可重试，刷新后也可恢复待确认请求。
- 编辑检查版本，另一台设备修改后不会静默覆盖。
- JPEG/PNG/WebP 封面更换和移除；限制原图 5 MB，最长边压缩到 1600 像素。
- 只有记录保存成功后才清理旧封面；失败进入本机清理队列，列表可重试。
- 私有图片使用一小时签名链接，页面打开期间约 50 分钟刷新一次。
- 新增和编辑的文字草稿按账号隔离、在本机保存，支持恢复和丢弃，离开前提示。
- 草稿不跨设备同步。未上传的本地图片不会保存到草稿，需要重新选择。

## 首次启用这次更新（必须先执行云端升级）

本地源码修改不会自动更新 Supabase 数据库。

1. 在 Supabase SQL Editor 执行 `supabase/migrations/20261015_records_workflow.sql` 的完整内容。
2. SQL 在一个事务中执行，允许重复运行，保留已有记录和图片，增加版本、更新时间和回收站字段。
3. 升级后网页写操作统一通过 `mutate_record`，旧网页的直接新增/编辑将失效。请在空闲时升级，并紧接着发布新版前端。
4. 本地验证登录、保存、编辑、筛选、分页、回收站与封面，然后再推送、部署。
5. 在手机和电脑用同一账号测试，在不同账号之间验证不能访问彼此的记录。

升级脚本限制为只读表 + 用户专用写入函数，仍须在真实项目中确认账号隔离。后台 SQL Editor 使用管理员权限，不能用其“能读到所有行”来判断网页的 RLS 是否失败。

## 本地运行

复制 `.env.example` 为 `.env.local`，填写本项目的 Project URL 与 Publishable key。

```powershell
npm install
npm run dev
```

只使用 Publishable key，不能把 Secret key 或 service_role 放进前端。`VITE_` 变量会出现在浏览器构建产物中；数据权限依靠数据库规则。

## 验证

```powershell
npm run lint
npm test
npm run test:browser
npm run build
```

- `npm test` 用 PGlite 在本机执行真实 PostgreSQL SQL，验证升级脚本、权限、重复请求、版本冲突和回收站生命周期。
- `npm run test:browser` 用本机 Chrome 跑交互测试。需要已安装 Google Chrome；没有 Chrome 时，可在 Playwright 配置选择安装好的浏览器。
- 浏览器测试使用隔离的模拟 Supabase 服务，不访问真实账号或记录，不能替代上线后的真实联调。
- 数据库测试中的 Auth、Storage 元数据和登录上下文在本地构造，不代表 Supabase Storage HTTP 服务也已经真实验证。
- 浏览器检查覆盖登录返回、过期会话、跨标签页退出、草稿保留、206 条记录分批导出、ZIP 封面内容、取消与失败、Markdown 安全显示及字体请求大小。

## 账号、备份与 Markdown 的使用

- 首页右上角和记录页面右上角可进入“我的账号”；退出使用 Supabase 的 `scope: 'local'`，其他设备继续保持登录。
- “记录管理 → 数据备份”或账号页的备份链接进入导出。选择 JSON 或 ZIP，点击“生成备份”，完成后再点击“下载备份”。
- JSON 包含记录文字、标签、创建和更新时间、版本、封面云端路径与回收站状态。ZIP 另含 `covers/` 和 `README.txt`，每条记录的 `cover_file` 指向 ZIP 内封面。
- 单次备份最多 50 MB。读取记录或封面失败时显示错误，不把不完整 ZIP 作为成功备份提供下载。
- 导出不包含登录凭证、本机未保存草稿或 Markdown 引用的外部图片。当前提供导出和本地解压查看，尚无自动导入入口。
- 备份读取多页记录，不是数据库事务快照；导出期间请避免在其他设备批量增删改记录。
- 编辑器点击“预览”查看排版，点击“写作”继续修改；“写作说明”在新标签页打开，保留当前编辑内容。
- Markdown 原文仍保存在原有 `content` 字段，已有记录保留原文。原始 HTML 不执行，危险 URL 使用渲染器默认规则过滤；未知代码语言以普通代码显示。
- 本次账号、备份和正文排版更新不增加数据库字段；已经执行过原有升级脚本的项目无需再次运行 SQL。

## 重建首页字体

字形来自仓库内原始霞鹜文楷。子集内部字体名改为 `Portfolio Hero`，版权和 OFL 许可保留在字体元数据及 `public/fonts/OFL.txt` 中。正文继续使用系统字体。

修改首页文案时，编辑 `src/lib/heroText.js`，再生成字体：

```powershell
python -m pip install --target .tools/fonttools fonttools==4.67.0 brotli==1.2.0
python scripts/build-font.py
npm run build
```

脚本覆盖全部首页主视觉文案及可打印 ASCII，检查字形是否齐全。生成的 `src/assets/fonts/portfolio-hero.woff2` 需要随源码提交，Netlify 构建无需安装 Python。Vite 为字体生成内容哈希文件名，沿用 `/assets/` 缓存规则。

实现参考：[fontTools 字体裁剪](https://fonttools.readthedocs.io/en/stable/subset/)、[Supabase 当前设备退出](https://supabase.com/docs/reference/javascript/auth-signout)、[react-markdown 安全说明](https://github.com/remarkjs/react-markdown#security)、[fflate ZIP 文档](https://github.com/101arrowz/fflate)。

## 发布

先执行云端升级并本地验证，再提交源码：

```powershell
git add src supabase tests scripts package.json package-lock.json playwright.config.js netlify.toml index.html .gitignore README.md .env.example
git commit -m "完善记录管理、搜索分页、封面和草稿"
git push
```

Netlify 已通过 `netlify.toml` 固定 `npm run build` 和 `dist`，带内容哈希的 `/assets/` 文件使用长缓存。控制台仍需设置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

环境变量变化后需要重新构建。当前使用查询参数路由，无需为详情页添加路径重写。

## 已知边界

- 待清理图片队列保存在当前浏览器；清除浏览器数据后，未完成的清理队列也会丢失。数据库不会因此丢记录。
- 回收站保留图片便于恢复，仍会占存储额度；彻底删除成功后才尝试清理。
- 保存操作回执目前保留在数据库，便于断网重试；长期大量使用后应制定保留期和清理任务。
- 查询分页不提供跨设备实时订阅；另一设备新增后，刷新列表查看。
- 云端升级 SQL 需要在 Supabase 控制台执行；推送 `main` 后，Netlify 自动构建并发布。发布结果应通过线上页面和构建资源确认。
