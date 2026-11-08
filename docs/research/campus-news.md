# 校园资讯：来源调研

工具「校园资讯」把活动与通知按来源分层整合：素拓数智平台（结构化、官方登记）→ 部处与学院官网栏目 → 微信公众号 → 钉钉群（实验）。本文记录各来源的接口事实、来源表的生成规则与取舍依据、WebPlus 结构与 WebVPN 规则，以及哪些还没有用登录态验证。调研时间 2026-11-06。

参考项目 dsh-zju-assistant 为 GPL-3.0，本仓库没有 LICENSE：只参考思路与数据结构，代码全部自写。we-mp-rss（MIT）、wewe-rss（MIT，已归档）只取协议事实。

## A 素拓数智平台（sztz.zju.edu.cn/dekt）

组织单位开展记点活动前必须在平台立项（浙大发本〔2024〕6 号第 12 条），所以这里是唯一能读到的官方活动登记库。盲区：不记点的活动、社团内部活动、招新不会出现（团委「学生活动」栏目、公众号补）。

登录沿用 `services/sztz.ts`（CAS service `https://sztz.zju.edu.cn/dekt/` → `POST /dekt/ctx` 校验 `anonymous === false`）。下面两个接口取自平台前端 bundle（`assets/hdzx-*.js` 活动中心页、`assets/tzgg-*.js` 学生端通知页），**未以登录态实测**：

| 用途 | 请求 | 返回 |
| --- | --- | --- |
| 活动列表 | `GET student/home/getXmList?keyword&page&limit&lx=2`（可加 `date=YYYY-MM-DD`）；前端 `limit=5`，应用用 20 | `{ code: 0, data: 项目[], totalPages }` |
| 通知 | `POST student/tzgg/ajaxList`，表单 `pageIndex / pageSize / count`（axios 封装用 `qs.stringify`） | `{ code: 0, count, data: [{ mc, nr(HTML), fbsj, fbr, fjid, fjmc }] }` |

项目字段（前端详情页用到的）：`mc` 名称、`lxdw.mc` 立项单位、`xmlb.mc`（`xmfl.mc`）类别（分类）、`xmlx.mc` 类型（`my` 美育 / `ly` 劳育）、`hdkssj/hdjssj` 活动起止、`bmkssj/bmjssj` 报名起止、`hddd` 地点、`zmrs` 招募人数（空为不限）、`bmrs` 已报名、`zxfs–zdfs` 记点范围、`fzr/lxdh` 负责人与电话、`lxsx` 简介（HTML）、`hdzysx` 注意事项（HTML）、`bmfs {value,label}` 报名方式——`value === 3` 为「不在本平台报名」，此时 `jtbmfs`（HTML）写具体报名途径，界面把它单独高亮显示；`hdhb` 海报文件 id（`common/file/view?id=`）；`sfbm` 本人已报名。

同页的 `student/home/hdbm`（报名）、`hdqxbm`（取消报名）、`hdsc`（收藏切换）都是写操作，**不调用**；界面只给「去素拓平台报名 / 查看」。

## B 部处与学院官网

### 来源表的生成（`scripts/news-sources.mjs` → `src/main/services/newsSources.ts`）

1. **学校名录**：`https://www.zju.edu.cn/xywxw/list.htm`（官网「机构 → 学院（系）」）页面脚本里的 `title / link` 对，按学部列出 46 个学院（系）及官网地址。名录之外补用户列出的已知缺口：竺可桢学院 `ckc.zju.edu.cn`、求是学院 `qsxy.zju.edu.cn`、丹阳青溪学园 `dqxy.zju.edu.cn`、紫云碧峰学园 `yunfeng.zju.edu.cn/on/`、蓝田学园 `lantian.zju.edu.cn/ltoffice/`（学园网址取自求是学院首页友链）、工程师学院 `pi.zju.edu.cn`、海宁国际校区 `www.intl.zju.edu.cn`。
2. **学院中文网**：首页若是入口页（栏目链接少于 6 个，只有「中文网 / 办公网 / English」几个入口，常是图片链接，或脚本 / meta 跳转），跟进中文网与办公网（`…/main.htm`、名为中文 / 办公网的链接，排除 English），最多两层；子路径站点（如 `lantian.zju.edu.cn/ltoffice/`）只收子路径下的栏目。
3. **栏目**：收首页上的栏目链接（`/xxx/list.htm`、`list.psp`），分页页 `listN.htm` 归并；名称或面包屑像学生事务的栏目（人才培养、学生、本科、研究生、教学、通知……）再进一层收它侧栏的子栏目；每站最多 90 个。栏目名取列表页的 `col_title`（首页上的「更多>>」链接没有名字），上级取面包屑 `col_path`。
4. **栏目筛选**（依据写进每行的 `basis`）：
   - 保留：名称含 通知、公告、公示、预告、教务、教学、学籍、选课、考试、评奖、评优、荣誉、奖励、奖助、资助、奖学金、助学、就业、实习、学工、学生、本科、研究生、学术报告、讲座、学术活动、论坛、竞赛、创新创业、第二课堂、培养、重点提示、招聘信息（就业类）、心理、活动；
   - 剔除：名称或上级含 人事、招聘（师资类）、师资、博士后、校友 / 系友 / 院友、工会、科研、学科建设、党务、党建、纪检、新闻、动态、风采、招生、下载、教工、离退休、采购、招标、简介、概况、领导、机构、沿革、联系、名录、学者、视频、图片、媒体、专题、宣传、年鉴、会议纪要、制度、文件、规章、培养方案、教学成果、教学研究、教改、资料、出国 / 出境（教职工因公出国公示）、办事指南、流程；
   - 例外：挂在学生名下的仍保留（「学生党建」「学生就业」：名称含「学生」即保留）；
   - 剔除 400 天未更新的栏目（列表上最新一条早于 400 天前，或列表页解析不出条目）；
   - 剔除近期条目（前 15 条）八成以上与已保留栏目重复的栏目：按条目数从多到少处理，汇总栏目（「全部通知」）先留；
   - 面向对象：名称或上级含 研究生 / 博士生 / 硕士 → 研究生，含 本科 → 本科，否则全体；
   - 同一单位里重名的栏目（几个「最新通知」）带上级栏目名区分。
5. **部处**：手工整理在 `docs/research/news-manual.json`，每行写明依据，生成脚本只核对能否打开与最近更新。收了本科生院（通知公告、求是大讲堂报名通知）、研究生院（全部公告）、党委学生工作部（最新通知、活动预告、学生资助、评奖评优、勤工助学、创新创业通知）、心理健康教育与咨询中心（挂在学工部网站「心理健康 → 重要通知」）、党委研究生工作部（通知公告、活动预告）、团委（通知公告、学生活动）、综合服务网（只收「教育教学」和「重点提示」两栏，其余栏目面向教职工）。默认关注全部部处，学院由用户自己勾。
6. 全部候选栏目的取舍记录在 `docs/research/campus-news-columns.json`（保留的逐条写依据，去掉的按原因归并）。

### 已知缺口（生成脚本取不到，需要单独适配或放弃）

| 单位 | 情况 |
| --- | --- |
| 光华法学院、化学工程与生物工程学院、环境与资源学院、社会学系 | 首页没有 WebPlus 栏目链接（社会学系是 PHP 站 `index.php/Service/index.html?tid=…`，「最新通知」在 `tid=35&sid=7`；办公网在内网 `10.203.7.77:82`） |
| 教育学院、管理学院、电气工程学院、能源工程学院、人工智能学院 | 是 WebPlus，但列表页由脚本渲染或用了解析器不认识的模板，读不到条目 |
| 海宁国际校区 | Drupal 站（`/zh-hans`），不是 WebPlus |
| 就业中心 | 正方就业系统，通知在 `jygz/new/newsList.zf`（动态接口，未适配） |
| 国际处 | `ir.zju.edu.cn/zxzx/list.htm` 的通知由脚本加载 |
| 教务网「各院系通知公告」（召回校验） | 未找到公开入口：`jwbinfosys.zju.edu.cn` 跳到 `zdbk.zju.edu.cn` 的正方登录页，登录页没有院系通知；本科生院网站（bksy）也没有该栏目。需要用登录态确认入口后才能做召回对比 |

### WebPlus 结构（`services/newsWebplus.ts`，桌面、安卓与生成脚本共用，不 import 任何模块）

- 静态 `list.htm` 未生成时 301 到动态 `list.psp`（HEAD 请求返回 403，要用 GET 跟随跳转）。
- 列表页：`<li class="col_title"><h2>栏目名</h2>`，面包屑 `col_path`；条目 `<li class="news n1"><span class="news_title"><a href='/2026/1030/c30845a3221066/page.htm' title='标题'>`，`<span class="news_meta">2026-10-30</span>`。地址里的 `/2026/1030/` 是建稿日期，`news_meta` 才是发布日期（实测相差可达数月），解析器优先取列表上的日期；列表日期晚于明天时多半是活动日期，退回地址日期。只写月日的按当年，晚于今天的算去年。
- 解析器的通用规则：一段 `<li>` / `<tr>` / `<dd>` 里第一个指向文章的链接算一条。文章地址：WebPlus `/cNNNaNNN/page.htm`、博达 VSB `/info/N/N.htm`、`redir.php?catalog_id&object_id`、公众号 `mp.weixin.qq.com/s` 等。
- 正文：`wp_articlecontent` / `v_news_content` / 公众号 `js_content`，取不到时整页文字。
- 全部 53 个站点按 UTF-8 声明，暂不需要 GBK 解码。

### WebVPN（`services/newsWebvpn.ts`）

直连失败的 `*.zju.edu.cn` 改经 WebVPN（Wengine）：`https://webvpn.zju.edu.cn/<协议[-端口]>/<hex(IV)><hex(AES-128-CFB(主机名))><路径与查询>`，密钥与 IV 都是 ASCII `wrdvpnisthebest!`，CFB 段长 128 位，密文截到主机名长度（已与 Node 的 `aes-128-cfb` 对拍一致）。改写后的页面里链接是 `/https/<IV><加密主机名>/…`，`unwebvpn` 用同一把钥匙的 CFB 解密还原成原地址，列表解析才认得。

**校外为什么要它**（2026-11-08 用户手机 5G 上 12 个栏目取不到）：公网 DNS 下 `bksy`、`zjutw` 没有 A 记录，`zhfw` 是 `webvpn.zju.edu.cn` 的 CNAME（直连拿到的是 WebVPN 登录页，200 但没有列表，旧版报「页面结构变了」），`xgb` 在校外也取不到列表。所以 `loadPage` 对校内域名：直连失败、超时（8 秒）或取到的页面解析不出列表时都改走 WebVPN。

**登录**：WebVPN 是另一套账号（「上网账号」，与统一身份认证无关，用户 2026-11-08 确认）。曾按 `/do-login` 用保存的统一身份认证账号自动登录，已删掉（账号不对，而且会累计失败次数）；应用不替用户登录。

### 条目级过滤（`services/newsFilter.ts`）

先按规则判：明确面向教职工、采购招标、科研管理、党政事务的去掉（标题里同时写了学生 / 本科 / 研究生 / 同学的不去）；明确面向学生的（报名、讲座、竞赛、奖学金、选课、考试、实习、就业、志愿……）留下；判不准的保留。（曾有可选的 DeepSeek 判断，2026-11-08 用户要求先去掉。）

## C 微信公众号

### 主路线：微信读书（`main/news/weread.ts`，仅桌面）

- 登录：弹窗加载 `https://weread.qq.com/#login`，用户自己用微信扫码；会话 cookie（`wr_vid` / `wr_skey` / `wr_rt`）存在独立分区 `persist:weread`（Chromium cookie 库在 Windows 上经 DPAPI 加密，与 safeStorage 同一机制）。应用不经手扫码与口令。
- 添加公众号：粘贴该号任一篇文章链接，取文章页的 `__biz`（Base64 的十进制号）得书号 `MP_WXS_<号>`，昵称取 `var nickname = htmlDecode("…")`。不调用微信读书的订阅接口。
- 文章：`GET /web/mp/articles?bookId&offset=0`（we-mp-rss 文档说已弃用、返回 -2041，但它的 cookie 校验脚本仍在用）；拿到 -2041 时退回 `GET /api/mp/cover?bookId`（只有最新一篇）。每个号之间隔 2 秒。
- 状态（界面上都是带下一步的控件）：未登录 →「扫码登录微信读书」；`errCode -2010 / -2012` 或 401 → 登录已过期 →「重新扫码登录」；HTTP 429 或「频繁」→ 被限制 24 小时，按钮写「明天 HH:MM 后再试」并禁用；正常 → 公众号列表（可移除）+ 添加框 + 退出。
- wewe-rss 的登录与列表经第三方中转服务器（`weread.111965.xyz`），不采用。
- 安卓端没有：微信读书登录要弹网页窗口扫码，安卓壳暂无这个能力。
- **以上全部未以登录态实测**（接口字段按 JSON 里带 `title` 与 `doc_url / url / reviewId` 的对象宽松提取）。

### 备选：本机微信数据库（用户决定不做，2026-11-06）

`biz_message_0.db` 为 SQLCipher 4（PBKDF2-HMAC-SHA512 256000 轮、AES-256-CBC、每页 HMAC），库里只有公众号文章的标题与链接。解密本身可以纯 TS 完成，但密钥只能从微信进程内存里扫出来：Node 做不到，要么带原生模块，要么用 PowerShell 内联 C# 调 `ReadProcessMemory`——后者正是杀软报毒的特征。按需求它只是 Windows 上默认关闭的备选，用户权衡后决定不做，界面也没有开关。

## D 钉钉（实验，默认关，仅 Windows 桌面，`main/news/dingtalk.ts`）

v0.1 的全局库拼法、uid 与 salt 来源是猜的，在真实数据上一条也读不到；2026-11-07 照公开的逆向结论重写（dsh-zju-assistant `core/dingtalk/lib/database.ts`、`content.ts`，GPL-3.0 只参考事实；NOBB2333/wechat-analysis-action `core-dingtalk/README.md`），在用户本机 v3 数据上按文件头校验通过（只看计数：12 个群、47 条通知，约 1.4 秒）。

- 目录：`%APPDATA%\DingTalk\globalStorage\storage.db` 为全局库；账号目录名是十六进制串加 `_v3`（与 uid 无关），旧版为 `<uid>_v2`；主库在账号目录的 `DBFiles\dingtalk.db`，同目录还有 members.db、calendar_v2.db 等，都加密。
- 全局库密钥：CPUID 0 号叶返回的 EAX（最大功能号，小整数）与厂商串的三个寄存器（厂商串第 0–3、8–11、4–7 字节按小端读成 int32）的十进制拼起来取前 16 字节；不调 CPUID，EAX 0–64 × 本机厂商串（取不到时 GenuineIntel / AuthenticAMD / HygonGenuine）逐个试，按文件头 `SQLite format 3 ` 校验。
- uid：全局库 `GlobalStorage` 表里全是数字的键与 `last_login_user_uid` 的值；`DTLastUserData` 等其余值含登录令牌，不读。
- salt：账号目录下的 `user_config` 文件，Base64 编码的 JSON，字段 `salt`。
- 账号库密钥：v3 = `MD5(PBKDF2-HMAC-SHA1(uid + salt, "666DingT", 1000, 32))` 十六进制前 16 位（"666DingT" 是 "666DingTalk888" 的前 8 字节）；v2 = `MD5(uid)` 十六进制前 16 位。uid 逐个试，按文件头校验。
- 解密：AES-128-ECB 逐 16 字节块；`-wal` 文件头与帧头明文、页数据加密，按盐值校验帧、只合并到最后一个提交帧，文件头第 18、19 字节改成 1（非 WAL），用 `node:sqlite` 的 `deserialize` 在内存打开（Electron 自带的 Node 才有）；明文缓冲 deserialize 后清零。
- 表：`tbconversation`（cid、type：1 单聊 / 2 群、title、alias）；消息在 `tbmsg_000…tbmsg_127` 分表与最近消息缓存 `tblastmsg`（cid、mid〔64 位，要 CAST 成文本读〕、localId、type〔3 为系统消息〕、createdAt、lastModify、version、contentVersion、contentType、content / extension〔JSON〕、recallStatus、shieldStatus、isDecrypt〔1 才是已解密的正文〕），同一条消息可能在几张表里各有一版，按 lastModify、version、contentVersion、撤回状态取最新的；`msg_clear_info`（cid、clear_timestamp）为清空聊天记录的时刻。
- contentType：1 文字、2 图片、102 链接、300 / 2900 / 2950 卡片、500 / 501 文件、1200–1202 / 1400 Markdown、1600 DING、3100 富文本。
- 正文（2026-11-07 照用户本机真实库逐类核对结构，`parseMessage`）：
  - 1 文字：`content.text`；@所有人存成 `@10`，@某人存成 `@<uid>`，换成群昵称（`tbuser_group_nick` 的 cid + uid → groupNick）或通讯录备注 / 昵称（`tbuser_profile_v2` 的 alias / nick）；钉钉表情 `[送花花]` 一类去掉。
  - 系统提示也是 1：入群合并消息的 extension 带 `merge` 或 `memberUid` / `memberNick` / `mergeTemplateType`，直播开始结束带 `liveState`；移出群聊、改群名称、设管理员、通过搜索入群是 extension 里没有 `realmFlag` / `realmOrgid` 的系统消息（人发的文字消息都带这两个）。只在后者上按句式认，「请还没进群的同学尽快加入群聊」这类人发的不会被去掉。
  - 2 图片：地址在 `down.dingtalk.com/ddmedia/…`，带 `authMedia`，要钉钉登录态，本机没有缓存文件；只记「图片」。
  - 102 链接：`attachments[0].extension` 的 title / text，地址在 `attachments[0].url`（智云课堂「开始上课」提醒也是这种）。
  - 500 / 501 文件：`f_name`；常标着 isDecrypt≠1，但 content 是明文 JSON、文件名可读，照收。
  - 1200–1202 / 1400 Markdown：`attachments[0].extension.markdown` 与 title。引用回复（消息 extension 带 `sourceMessageId`）的 markdown 是「> 被引用的原文 + 分隔线 + 回复」，回复本身在第二个附件的 `replyContent`（三处都取会出现三遍），改成回复在前、原文作引用块。
  - 1600 DING：`dingContent`。3100 富文本：`desc` 是完整纯文字，payload 是同样内容的富文本，只取 desc。
  - 300 / 2900 / 2950 卡片：会话列表那一行在 `LastMessageI18n.zh_CN` / `interactiveCardLastMessage`（「[群公告]」「[投票]」「[钉钉文档] 名称」或整句，如直播回放、访客邀约）。**群公告全文在消息 extension 的 `biz_custom_desc`**（先前以为本机只有「[群公告]」几个字，判断错了），投票题目在 `biz_custom_title`，钉钉文档名在 `biz_custom_desc`（带「[分享] 」前缀）、链接在 `biz_custom_action_url`（alidocs.dingtalk.com）。标题写成「群公告：…」「投票：…」「钉钉文档：…」。
  - 其余类型才按显示字段兜底取（text / markdown / title / desc / LastMessageI18n …，容器 attachments[].extension 等），去掉被别的片段包含的重复片段。
- 取哪些：**不替用户分哪条是通知**（用户要求：只保证格式正确、信息完整，取舍交给用户；先前按字眼、发送人是不是群管理员判断，课程群里分不准）。全部会话——群聊、单聊、工作通知、钉钉云盘 / 直播助手一类系统账号——近 60 天的全部消息，最多 2000 条；只去掉系统提示、撤回与屏蔽、清空记录之前、本地没解开且读不出的。会话名：群名；单聊常没有标题或标题是对方 uid，按对方昵称。`from` 为「会话 · 发送人」（自己为「我」；单聊里对方发的、认不出的不写）。界面「来源」侧页按会话勾选（群聊 / 单聊两组，单聊的 cid 是「uid:uid」，组标题勾整组），不看的会话存 `NewsSettings.dingtalkHidden`（新出现的默认看），界面与 MCP `get_campus_notices` 都按它筛。
- 2026-11-07 用户本机实测（只看计数，`lastStats`）：60 天 805 条消息（客户端没同步的读不到，这是上限），107 个会话里 36 个有消息；去掉 235 条系统提示（入群合并 133、其余 102）与 63 条撤回，留下 506 条。
- 解密后的库与消息只在内存里，不写盘、不缓存、不发给任何模型；调试时只打印计数（按天统计内容会被权限分类器拦下）。
- 回归：`ELECTRON_RUN_AS_NODE=1 npx electron scripts/test-dingtalk.mjs` 在临时目录合成一份 v3 结构（加密的全局库、user_config、带未合并 WAL 的分表主库、tblastmsg、通讯录与群昵称，内容全是编的），覆盖编辑过的文字取最新版、@10 与 @uid 换名字、发送人、群公告正文、投票题目、文档链接、引用回复、富文本、链接、标着没解开的文件、图片、只在 tblastmsg 的、两个按 JS 数字会撞的 64 位 mid、无标题单聊与标题是 uid 的系统账号；应去掉的撤回、清空前、系统提示，人发的「加入群聊」要留（通过）。

## 未实测清单

- 素拓 `getXmList` / `tzgg/ajaxList` 的登录态返回（字段按前端代码推出）。
- WebVPN 的地址改写（应用里没有 WebVPN 登录）。
- 2026-11-08 查明：用户手机走校园 5G 专网（10.x 可达），但系统 DNS 给公网答案，`bksy` / `zjutw` 解析不到，`xgb` / `ygb` 连到公网地址被回「仅限校内」403，`zhfw` 指向 WebVPN。安卓端原生请求改为校内域名先问学校 DNS（`CampusDns.java`），模拟器 `-dns-server 223.5.5.5` 下旧代码 11 处失败、改后 0 处。
- 微信读书全部接口与状态码。
- 钉钉库位置、密钥派生、表结构。
- 教务网「各院系通知公告」的入口（召回校验未做）。
