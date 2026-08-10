# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

CAN 考试中心。第三个卫星站点，和 can-dev、can-radar 同一套：Astro SSR、Vue 岛屿、
Tailwind v4。**没有自己的登录，没有数据库，题库和答案一行都不在这里。** README 是
给人读的那一份。

## 命令

```bash
bun run dev      # :4324（4321 can-web，4322 can-dev，4323 can-radar）
bun run lint     # format:check + astro check + vue-tsc
bun run build && bun run start
```

没有测试套件。门禁是 `bun run lint` 加一次 `bun run build`。
`astro check` 看不见 `.vue`，所以 `typecheck` 同时跑 `vue-tsc`——两个都要留着。

真正的逻辑测试在上游：抽题、打乱、判卷都在 can-api 的 `internal/exam`，那边
`go test ./internal/exam/` 是纯逻辑、不需要数据库。这一侧改动想验证正确性时，多
半该去改那边的测试。

## 六条要紧的

**1. 题库、答案、判卷，一样都不在这个仓库里。**

它们在 can-api 的 MySQL（`examPaper` / `examQuestion` / `examOption` /
`examAttemptPaper`）和 `internal/exam` 里。这个站点拿到的卷子是 can-api 抽好、
**去掉答案**之后的那一份 —— 整个前端被翻个底朝天，也翻不出任何一道题的正确选
项。想在页面上「顺便显示一下正确答案」时会发现无处可取，那正是设计。

唯一的例外是题库管理页（`/admin/*`），它显示答案，因为它的数据走的是上游
`WithSuper`（教员及以上）后面、再按 division 过滤过的另一组路由。那一侧的类型在 `src/lib/admin.ts`，和考生
侧的 `src/lib/exams.ts` **刻意不共享任何结构** —— 共享一个 `Question` 类型的
话，某天有人在考生页面上写 `q.options[i].isCorrect`，TypeScript 会愉快放行，而
运行时恰好是 undefined，于是没有人发现这行代码写错了。can-api 那边做了同样的切
分（`exambank.go` 对 `superexam.go`）。

**2. 一张卷子只能交一次，这不是防呆，是安全边界。**

分数本身就是一个预言机：攥着同一张卷子反复交、每次只改一个答案，分数的变化就把
正确选项一道道点出来了。随机抽题让这件事**更**好用（卷子终于不变了），所以上游
在交卷的同一个事务里把卷子 consume 掉，第二次交是 409 `already_submitted`。

这一侧要配合的有三处，改 `SitPaper.vue` 时别拆掉：交卷前弹确认框（全站唯一一
个）、成功后立刻锁死按钮、收到 409 当成「已经交过了」而不是错误。

**3. 发卷是 POST，不是 GET。**

发卷会写库（抽一次题、把题号和选项顺序落库）。写成 GET 意味着一次预取、一次爬
虫、一次浏览器的推测加载都能替人抽走一张卷子。`/sit/[slug]` 这个**页面**在没有
`?token=` 时不发卷，是岛屿挂载之后 POST 一次再把 token 补进地址栏。

手上已经有没交的卷子时，上游返回的是**同一张**而不是新抽的。那条规矩在上游，这
一侧只要别绕过去：如果重开一次就换一套题，抽题就变成了重摇 —— 关掉标签页再来一
次，直到题目顺眼为止，而每一张丢掉的卷子都多泄露一片题库。

**4. 刷新安全，但答案存在 sessionStorage 里。**

卷子按 token 从上游重新取，题目和选项顺序都是发卷时记下来的那一份。但**已选的
答案不在上游** —— 那只在浏览器里。`SitPaper.vue` 把它存进 sessionStorage（键带
token），一次误触 F5 不该让人重答二十道题。隐私模式下 sessionStorage 会抛，所以
每一处读写都包着 try。

**5. `checkOrigin` 关着，Origin 检查在 `src/server/guard.ts`。**

Astro 在 SSR 下默认从 `Host` 头推出本站 origin 再和浏览器的 `Origin` 比对；这个
站跑在 TLS 终止的反代后面，推出来的是 `http://`、浏览器发的是 `https://`，永远
对不上，**每一个 POST 都是 403**。can-web 从一开始就关了，can-dev 和 can-radar
都是踩了才关的。

关掉不等于不检查：检查换到 `guard.ts`，比对**显式配置**的 `PUBLIC_ORIGIN`，那个
值不是从请求头推的，反代动不了它。**部署里 `PUBLIC_ORIGIN` 不能省** —— 省掉它
交卷会稳定地 403，而那是这个站点最不能坏的一个动作。

**6. 页眉的跨站链接必须走 `siteOrigin`。**

这里是 exam.airwaysn.org，写 `href="/roster"` 会打在考试中心自己的域名上然后
404。开发机上不会暴露（那边主站和这个站都在 localhost），线上才炸。

## 和上游的接口

浏览器**从不**直接和 api.airwaysn.org 说话。所有调用走本站 `/api/v1/*` 下的转
发，在服务端带着 cookie 发出（`src/server/upstream.ts` 是唯一一条路）。于是不需
要 CORS —— exam.airwaysn.org 不在 can-api 的 `ALLOWED_ORIGINS` 里，也不需要在。

| 本站                                          | can-api                                     |
| --------------------------------------------- | ------------------------------------------- |
| `GET /api/v1/papers`                          | `GET /api/v1/pilot/exam/papers`             |
| `GET /api/v1/history`                         | `GET /api/v1/pilot/exam`                    |
| `POST /api/v1/sit/{slug}`                     | `POST /api/v1/pilot/exam/papers/{slug}/sit` |
| `GET·POST /api/v1/sittings/{token}`           | `…/pilot/exam/sittings/{token}`             |
| `/api/v1/admin/**`                            | `/api/v1/super/exam/**`（WithSuper）        |
| `GET /api/v1/session`、`POST /api/v1/signout` | `…/auth/session`、`…/auth/signout`          |

**这一侧一次授权判断都不做。** 不看 rating、不看会话内容，只把 cookie 转过去、
把状态码抄回来。两处各判一次的话，两处会慢慢长得不一样，而更宽松的那一处就是实
际生效的那一处。`lib/member.ts` 的 `canManageBank()` 只决定**画不画**管理入口。

## 谁能改题库

**教员及以上，按 division 分权。** 一开始是 SUP/ADM 独占 —— 对一张决定谁能拿到
什么等级的表来说那是对的默认值，代价是全网每个 division 的理论题都要那两个人来
写。

上游一份卷子要同时过两道门（细节在 can-api 的 `internal/exam/authority.go`）：

- **Division。** `examPaper.region` 用的是 `division.region` 那套编码。教员能改
  自己挂着 active `instructor` 行的那些 division 的卷子。**0 是「全网」不是「没
  填」** —— 入网测试在 0 上，只有 SUP/ADM 能碰。
- **等级。** 一份卷子不能被「它可能提升到其自身等级或更高」的人**管理** —— 注意
  是管理，不只是「不能把 promoteTo 设成那个值」。能改一份授予 I3 的卷子的**题
  目**，就能把它改简单然后自己去考；只卡 promoteTo 那个字段的话，这扇门还开着，
  而那正是有人会走的那扇。谁都不能授予 SUP/ADM，ADM 自己也不行。

两个后果这一侧要配合：

**读和写卡得一样死。** 管理端的题目带 `isCorrect`，所以「能看」和「能改」在这里
是同一个权限；给别的 division 一个只读视图，只是慢一点地泄题。

**下拉里的选项不是这边算的。** 卷子清单的响应里带着 `authority`（能管哪些
division、最高能授予到哪一级），`BankPapers.vue` 拿它画 region 和 promoteTo 两
个下拉。自己算的话，一个 I1 和一个 ADM 会看到同一份选项，然后其中一个人保存时撞
403。

`lib/member.ts` 的 `MIN_ADMIN_RATING` 是 8（I1），它只决定页眉上画不画那个链接。
rating 够但在任何 division 都没有 instructor 行的人，上游答 403，管理页显示「你
不管理任何 division」—— 那需要查库，只有 can-api 判得了。

## 卷子的升级

一份卷子可以设 `promoteTo`：通过之后把成员的 rating 提到那个值。提升受卷子的等级
门槛约束（上游的提升语句带 `AND rating IN (…)`），所以一个后来被教员提上去的人，
不会被他上个月考的卷子按回观察员。

## 上线顺序

题库在 can-api 那边，所以第一次部署有两步在这个仓库之外：

1. can-api：`prisma db push`（四张新表）
2. can-api：`go run ./cmd/seed-exam`（把硬编码那份入网测试灌进题库，落在
   `examPaper` id = 1 —— `exam.examId` 里已有的历史记录全都写着 1）
3. 才轮到这个仓库的 `deploy/k8s.yaml`

跳过第 2 步站点起得来，但一场考试都列不出来。那不是故障，是题库真的空着。

## 和 can-web 的关系

can-web 的 `/exams/*` **还在，没有动**。它调的是 can-api 那条硬编码的
`/api/v1/pilot/exam/new`（15 题固定卷、固定顺序），那条路是 published contract，
这次一个字都没改。两套并行跑着，等这边跑稳了再决定迁移和跳转 —— 那是另一次改
动，不要顺手做掉。
