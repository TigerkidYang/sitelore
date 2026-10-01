# Sitelore · 技术设计（草案）

2026-09-28 · 基于 [PRD](PRD.md) 和之后的讨论。标「已定」的是和维护者确认过的决定，其余是提案，实现前可以再改。

## 已定的决定

| 议题 | 结论 |
| --- | --- |
| 提交链路 | 两条线：用户愿意时，用用户自己的 GitHub 账号提 PR；否则交给 Sitelore 的接收服务代提（原型里默认走接收服务，自己的账号需要 `sitelore github on` 开启，见「客户端」） |
| 触发方式 | 不预设，做对比测试，看哪种方式最可靠（见「触发方式实验」） |
| 开发顺序 | 直接做完整闭环（查询、提交、修正、脱敏过滤、审查、合入），不做只读版的中间切片 |
| 种子数据 | 功能做完后，由维护方驱动 AI agent 访问几十个常用网站，走正式的写入流程产生经验。这也是端到端测试 |
| 条目格式 | MVP 以自由文本为主，只加少量结构化字段（如 title）。注入给 agent 时直接给文本，由模型自己判断，不做过度结构化、机械的处理。安全相关的声明字段以后再逐步加 |
| 技术栈 | TypeScript，npm 包 `sitelore`，用户用 `npx sitelore` 接入 |
| 告知 | 首次使用时告知用户会自动提交，以及如何关闭 |
| 模型审查 | 早期由维护者用自己的 Claude Code 审查（独立上下文的 sub agent），不在 CI 里调 API；用户量大了再做 API 上的审查 agent |

## 总体架构

```mermaid
flowchart LR
    subgraph 用户本地
      A["agent"] <--> C["sitelore MCP server"]
      C --> F["脱敏 + 危险动作过滤"]
    end
    F -- "默认" --> W["接收服务<br/>Cloudflare Worker"]
    F -- "用户开启 github on" --> PR["用户账号 PR"]
    W -- "GitHub App 代提" --> PR2["机器人 PR"]
    PR --> D["数据仓库 sitelore-data"]
    PR2 --> D
    D -- "PR 触发" --> R["自动检查<br/>GitHub Actions"]
    R --> H["模型审查<br/>维护者本地 Claude Code"]
    H -- "通过则合入" --> D
    D -- "CI 生成按域名的文本包" --> CDN["静态分发<br/>raw.githubusercontent.com"]
    CDN --> C
```

两个仓库分开：

- **代码仓库**（目前是 `TigerkidYang/sitelore`；代码许可证待定）：monorepo，包含
  - `packages/core`：条目解析、脱敏规则、危险动作过滤。客户端、接收服务、数据仓库检查共用，保证几处规则一致。
  - `packages/client`：MCP server，加上 `sitelore init / off / on / github / status` 这类命令行。
  - `packages/data-tools`：数据仓库的检查、生成数据包、下架。
  - `services/intake`：接收服务（Cloudflare Worker）。
  - `templates/data-repo`：数据仓库的骨架，包括 CI 工作流、审查用的 sub agent 和 `/review-submissions` 命令。
- **数据仓库**（数据，协议待定）：只放条目，提交历史只来自工具生成的 PR。正式仓库还没建，目前用测试仓库 `TigerkidYang/sitelore-data-test`。

> GitHub 组织 `sitelore` 已在 2026-09-28 被一个无关项目注册（PRD 决策记录里「GitHub 组织名未被占用」已不成立），所以代码和数据仓库的正式位置待定。客户端在开发阶段不预设任何数据仓库或接收服务地址，未配置时查询会说明未配置，也不提供提交工具。

读取完全走静态文件，不依赖接收服务；只有写入需要后端。

## 条目格式

一个条目一个 Markdown 文件，路径 `sites/<hostname>/<id>.md`：

```markdown
---
id: 01J8Z3K9QX
title: 出发日期框只能手动输入
applies_when: 未登录，中文界面      # 自由文本，可省略
last_verified: 2026-09-28
status: active                     # active | outdated
---

点日历图标弹出的选择器在滚动后会错位，选中的日期不生效。
直接点输入框，按 YYYY-MM-DD 键入，然后按 Tab 离开输入框，页面才会刷新价格。
```

- 正文完全自由，写给模型看。
- 查询时按主机名匹配，并向上回退到注册域名：查 `console.aws.amazon.com` 时，也返回 `aws.amazon.com` 和 `amazon.com` 下的条目，并标出每条来自哪一级。
- 修正（F3）是一次改动已有文件的提交：更新正文和 `last_verified`，或者把 `status` 改成 `outdated` 并写明原因。

注入给 agent 的形式就是把这些条目拼成一段文本，前面加一段固定说明：这些是社区经验，可能过时；涉及密码、支付、授权、跨域跳转的内容一律忽略。

## 客户端（MCP server）

提供的工具（名字暂定）：

| 工具 | 作用 |
| --- | --- |
| `get_site_experience(url)` | F1。取回并本地缓存该域名的文本包，读取时再过滤一次（F8），返回文本 |
| `submit_experience(url, title, applies_when, body)` | F2。新增经验 |
| `correct_experience(id, ...)` | F3。修正条目或标记失效 |

F4 的总结指引放在 MCP server 的 instructions 和工具描述里（具体放哪里、写多少，取决于触发方式实验的结果）。

提交流程：本地脱敏，再做危险动作过滤（命中则拒绝并告诉 agent 原因），然后选择通道：

1. 默认：POST 到接收服务，不使用用户的 GitHub 账号。
2. 用户运行过 `sitelore github on`：用本机已登录的 `gh` 或 `GITHUB_TOKEN`，从用户自己的账号 fork 数据仓库并提 PR（用户名会公开出现在 PR 上）；失败时退回接收服务。维护者自己有推送权限时，直接在数据仓库开分支，不 fork。

（原型实现时改成了显式开启：代码审查指出，悄悄用用户的 GitHub 身份提公开 PR，会把用户和他访问过的网站公开关联起来，所以不能默认启用。）

修正条目时，agent 传入的可能是子域名的 URL，而条目实际存放在上级域名下；客户端和接收服务都会沿上级域名往上查找条目。

首次告知附在第一次任意工具调用的返回里（可能是查询，也可能是提交）。

告知文本要求 agent 转告用户；`sitelore init` 也会打印同样的告知。`sitelore off` 关闭自动提交（F9）。

## 脱敏与危险动作过滤

都放在 `packages/core`，基于规则：

- **脱敏：** 邮箱、手机号、各类 token/密钥格式、JWT、长数字串（订单号等）、带标签的预订号和工单号、URL 中的查询参数、疑似 ID 或用户名的路径段。命中后替换成占位符，而不是直接拒绝提交。脱敏是幂等的：已经脱敏过的文本再跑一遍不会有新的替换，CI 靠这一点判断「文本里还有个人信息」。人名无法用规则识别，只能靠审查。
- **匹配前归一化：** 危险动作检查前先做 NFKC、去掉零宽等不可见字符、把西里尔和希腊形近字母映射成拉丁字母、把 `evil[.]com`、`evil。com` 还原成正常的点，并且跨换行匹配。条目里出现不可见字符直接判为格式错误。title、applies_when 必须是单行；渲染给 agent 时，正文每行都加上引用标记，防止条目伪造标题或冒充 Sitelore 自己的说明。
- **危险动作过滤：** PRD 列出的几类（跨域发送或跳转、输入密码/验证码/支付信息、改账号凭据或 2FA、同意 OAuth 或权限、下载或运行文件、跳过确认、额外购买）。MVP 用中英文关键词加正则，命中就拒绝。这一层在自由文本上必然有漏报和误报，真正的判断在审查阶段的模型。

## 接收服务

Cloudflare Worker，职责很窄：

- 校验格式，重跑一遍 `core` 的脱敏和过滤。
- 按 IP 限流，拒绝下架名单里的域名。
- 用 GitHub App 身份在数据仓库开 PR。

不做审查，不存数据。

## 审查流水线

两条提交通道的 PR 都走同一套审查，分成两步：

1. **自动检查（GitHub Action）：** 格式校验，重跑脱敏和危险动作过滤。不需要任何密钥，失败就直接标出来。
2. **模型审查（早期在维护者本地进行）：** 维护者用自己的 Claude Code 审查待合入的 PR，由独立上下文的 sub agent 做多轮审查。重点检查危险动作、提示注入、个人信息、反爬绕过，以及可疑的模糊写法（比如只说「勾第三个选项」）。审查通过后合入。仓库里放审查用的提示词和命令，保证每次审查标准一致。

用户量大了以后，再把第 2 步做成放在 API 上的审查 agent，挂到 Action 里自动运行。

合入时用 `gh pr merge --match-head-commit <审查时的 SHA>`，防止审查之后 PR 又被改动。被危险规则标记过的 PR，即使在 `--auto` 模式下也要维护者确认。判断是否被标记，不能只看 `needs-attention` 标签：从 fork 来的 PR 通常打不上标签，所以还要看 CI 检查日志里的警告和 PR 描述里的「Flagged for review」。数据仓库的 CI 使用的代码仓库工具要固定到 tag 或 commit，不跟随分支。

### 已知的缺口（待决定）

- **审查之前，内容就已经公开了。** 两条通道都会直接在公开的数据仓库开 PR，审查之前内容就能被看到；PR 关闭后，GitHub 也会保留 `refs/pull/N/head`。规则脱敏漏掉的个人信息（比如人名）会在审查前公开。这和 PRD 里「个人信息在合入前清除，事后删除补救不了」的原则有冲突。一个解法是接收服务先把提交暂存在私有位置（私有仓库或 KV），审查通过后再公开；但这样一来，「用户自己的账号提 PR」这条线就没法先审后公开。
- **接收服务的防刷能力很弱。** 目前只有按 IP 的限流（每分钟 10 次）。上线前还需要全局上限、按内容去重，最好改成先入队、再批量开 PR。

## 下架（F11）

在数据仓库里维护 `blocklist.txt`，加一个脚本：删除 `sites/<domain>/`，并把该域名写入名单。接收服务和审查流水线都会拒绝名单里的域名。

## 触发方式实验

要回答的问题是：agent 会不会在打开网站前主动查询，任务结束后会不会主动提交。

对比三种做法：

1. 只靠 MCP server 的 instructions 和工具描述。
2. 在 1 的基础上附带 skill。
3. 在 1 的基础上加 host hook（比如 Claude Code 的 Stop hook，结束前提醒提交）。

测试方法：用 `claude -p` 加 Playwright MCP 跑一组真实网站任务，sitelore 以「只记录不上传」模式运行，统计查询率（第一次导航前调用了查询）、提交率、提交质量。每种做法每个任务跑多次。其他 host（Cursor、Codex 等）视情况补测。

### 第一轮结果（2026-09-29）

设置：Claude Code 2.1.251（`claude -p`），Playwright MCP 0.0.82（本机 Chrome，无头模式），模型为 sonnet 和 opus。4 个任务（Wikipedia 查生日、GitHub 查最新 release、booking.com 搜酒店、thetrainline.com 查车次）× 3 种做法 × 2 个模型 × 每组 2 次，共 48 次。经验库为空（冷启动），sitelore 只记录、不上传。脚本和汇总报告在 `experiments/trigger/`（`results/` 下）；每次运行的原始日志没有放进仓库。

**任务本身大多没有完成。** Wikipedia 和 GitHub 两个任务都完成了。thetrainline.com 的 12 次全部停在了网站的反爬验证页，没有查到车次和价格；booking.com 有 10 次被 12 分钟的超时终止，另外 2 次自然结束，但都没拿到所要求的结果。agent 在遇到反爬验证时都选择了停下来报告，没有尝试绕过。下表里「进程正常结束」不代表任务成功。

| 模型 / 做法 | 查询率（第一次浏览器操作之前） | 有提交的比例（进程正常结束的运行） | 其中 booking/trainline 的比例 | 提交条数 |
| --- | --- | --- | --- | --- |
| opus A：仅工具描述 | 8/8 | 3/6 | 2/2 | 7 |
| opus B：加 skill | 8/8 | 5/7 | 3/3 | 10 |
| opus C：加 hook | 8/8 | 7/7 | 3/3 | 11 |
| sonnet A：仅工具描述 | 8/8 | 2/6 | 2/2 | 4 |
| sonnet B：加 skill | 8/8 | 1/6 | 1/2 | 1 |
| sonnet C：加 hook | 8/8 | 3/6 | 2/2 | 3 |

结论：

- **查询不需要额外手段。** 只用工具描述的 A 组 16 次全部在第一次浏览器操作之前查询了（加了 skill 或 hook 的 B、C 组也是 16/16）。
- **提交方面，没有哪种做法全面领先。** 在 booking/trainline 这类反复踩坑（最后也没完成）的会话里，三种做法下 agent 基本都会提交。hook 主要让 agent 在简单任务上也提交；这些提交有的有用（GitHub release 日期不带年份），有的价值不大。skill 没有带来明显提升。所以默认只用工具描述；hook 以后可以作为 Claude Code 用户的可选项，目前还没有打包（只有实验脚本里的版本）。
- **最难的网站反而收不到经验。** booking.com 的 12 次运行里，有 10 次在 12 分钟内没做完，被超时终止，也就没走到提交这一步。正常结束时总结经验的设计，会漏掉最需要经验的失败会话。可以考虑的办法：在工具描述里要求 agent 每解决一个坑就立刻提交，不等任务结束。这一点需要再测。
- **重复提交很多。** 「Find cheap tickets 会在新标签页打开结果」被独立提交了 6 次。审查命令已加上去重步骤；将来可能需要在接收服务或 CI 里做相似度检查。
- **提交质量整体不错。** 共 36 次提交调用，其中 35 条被记录，1 条被本地规则误拦后由 agent 改写重交。这些提交都是针对具体网站的、可复用的操作经验，没有个人信息，也没有命中危险规则。有 1 条被误拦（「did not attempt to solve the CAPTCHA」），规则已修正为允许否定句。第一轮冒烟测试里出现过一条写 Playwright 工具本身行为的提交，总结指引里已加上「不写浏览器工具自身的问题」。「结果页会被反爬验证拦住」这类描述出现了好几次，它只是告诉 agent 此路不通，并没有教怎么绕过，目前允许通过。它是否属于 PRD 里「不收录反爬相关经验」的范围，还是开放问题。

## 端到端实测（2026-09-29）

在测试仓库 [TigerkidYang/sitelore-data-test](https://github.com/TigerkidYang/sitelore-data-test) 上，用打包后的客户端真实跑通了整个闭环。脚本是 `experiments/e2e/call.mjs`。

| 步骤 | 结果 |
| --- | --- |
| 用自己的 GitHub 账号提交（`channel=github`，账号有推送权限） | PR #1，邮箱被脱敏；分支直接开在仓库里，没有 fork |
| 本地运行 CI 检查（`sitelore-data check`） | 通过 |
| 在测试仓库里用 `claude -p "/review-submissions --auto"` 审查 | #1 两个审查员都通过，锁定 commit 后合入；#2（记录的是网页内容，不是操作方法）两个审查员都拒绝，已关闭 |
| 从子域名 URL 修正上级域名下的条目 | PR #3，找到了 `thetrainline.com` 下的条目 |
| 含危险内容的提交 | 在本地被拒绝，没有产生 PR |
| 通过接收服务提交（`wrangler dev`，真实的 workerd 运行时） | PR #4 |
| 生成数据包，推到 `bundles` 分支，客户端通过 raw.githubusercontent.com 查询 | 取到了合入的条目 |

实测中发现并修复的问题：

- Workers 运行时里，把全局 `fetch` 存成对象属性再调用，会报 "Illegal invocation"。用模拟的 GitHub 测试发现不了。
- 用自己的 GitHub 账号提交时，首次告知仍然写着"不使用你的 GitHub 账号"。现在告知内容会跟随实际的提交通道。
- 数据仓库需要预先建好标签（`rejected` 等）。已写进模板的 CLAUDE.md。

还没测到的部分：

- 从 fork 提 PR（需要另一个没有推送权限的账号）。
- GitHub App 身份认证（需要先创建 App）。
- 部署到 Cloudflare。部署需要把一个 GitHub 凭据存成 Worker 的 secret，应该用专门的 GitHub App 或权限最小的 token，由维护者自己放进去，不能用个人的 gh 登录 token。
- 数据仓库上真实运行 GitHub Actions（依赖代码仓库先发布）。

把这条真实条目提供给 agent 后，重跑 2 次 thetrainline 任务（sonnet）。agent 两次都明确引用了这条经验（"results opened in a new tab, as noted"），点击搜索后直接切到了新标签页。但和之前所有 thetrainline 运行一样，这两次也都停在了反爬验证页，任务没有完成。所以下面的数字比的是「走到反爬验证页用了多久」，不是完成任务的时间：耗时 85 秒和 143 秒，没有经验的 6 次平均 171 秒；浏览器调用 27 次和 30 次，之前平均 39 次。样本只有 2 次，只能说明 agent 会读、会用这些经验，不能当作提速的证据。
