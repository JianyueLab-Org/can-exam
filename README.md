# can-exam

Cerulean Aviation Network 的**考试中心** —— `exam.ceruleanavi.net`。

入网测试和各席位的理论考试在这里进行。题目从题库里**随机抽取**，每道题的选项顺
序**每次都打乱**，所以两个人同时开考拿到的不是同一张卷子。题目可以带图（航图、
进近板、地面标志），也可以是多选。

Astro SSR + Vue 岛屿 + Tailwind v4，和 can-dev、can-radar 同一套。

## 它做什么，不做什么

**做：** 列出你能考的卷子、把抽好的卷子画出来、收答案、显示成绩；**每个 division
的教员**还能在 `/admin` 里管理自己 division 的题库（增删改题、设抽题数、及格线、
等级门槛、通过后的升级）。SUP/ADM 管全部，包括全网级的入网测试。

一份卷子归哪个 division，就由那个 division 的教员来写 —— 别的 division 的题库连
看都看不到，因为管理端的题目是带答案的。谁能改什么由 can-api 说了算，这边只负责
把它画出来；规则写在 `CLAUDE.md` 的「谁能改题库」。

**不做：**

- **没有登录。** 会话 cookie 是 can-api 签的、Domain 是父域，浏览器本来就带过
  来了；这个站点只是认得出来。登录入口只有主站一个。
- **没有数据库。** 题库、卷子、成绩全在 can-api 的 MySQL 里。
- **没有答案。** 发下来的卷子是 can-api 去掉答案之后的那一份。判卷也在那边。
- **没有图床凭据。** 题目配图存在 Cloudflare R2 上，读走 `cdn.ceruleanavi.net`。上
  传那一下是转发给 can-api 的，R2 的密钥只在它那边 —— 和这个站点不碰数据库是同
  一条规矩。

## 多选题怎么算分

单选题全对才得分。多选题**按比例给分**：

```
这一题的得分 = 选对的个数 / 正确答案总数 − 选错的个数 / 错误选项总数   （最低 0 分）
```

于是「全都勾上」恒等于 0 分，不管一道题有几个正确答案 —— 这正是选这个公式而不是
「每选错一个扣固定分」的原因，后者在「4 个正确 + 1 个错误」的题上全勾能拿 75 分。

两条边界，题库管理页会挡：一道多选题**可以只有一个正确答案**（不然「它是复选框」
本身就泄露了答案个数），但**不能全部正确**（那样扣分项就没了）。

单选题上多勾一个直接判 0 分，不给部分分 —— 给的话，四选一的题里蒙两个的期望收益
比老老实实蒙一个还高。

## 跑起来

```bash
bun install
bun run dev          # http://localhost:4324
```

`.env.example` 复制成 `.env`。本地开发一般只需要改一处：如果主站也在本地跑，把
`CAN_WEB_ORIGIN` 指到 `http://localhost:4321`，否则页眉上的「登录」会把你送到线
上去。

| 变量             | 作用                                                      |
| ---------------- | --------------------------------------------------------- |
| `CAN_API_ORIGIN` | 数据层。题库、发卷、判卷、会话都问它                      |
| `CAN_WEB_ORIGIN` | 主站。页眉导航和唯一的登录入口                            |
| `PUBLIC_ORIGIN`  | 本站对外地址，只用来校验写操作的 Origin。**部署里必须设** |

这个站点**没有**为图片新增任何环境变量。R2 的那五项（`R2_ENDPOINT` / `R2_BUCKET`
/ `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_PUBLIC_BASE`）全在 can-api
的部署里。整组不配是支持的状态：上传按钮会说「这个部署没配图片存储」，其余一切
照常 —— 本地开发不需要一个桶。

门禁：

```bash
bun run lint         # prettier --check + astro check + vue-tsc
bun run build
```

## 页面

| 地址          | 是什么                                   |
| ------------- | ---------------------------------------- |
| `/`           | 能考什么 + 我的成绩                      |
| `/sit/<slug>` | 考场。`?token=` 指向一张已经抽好的卷子   |
| `/admin`      | 题库管理：卷子清单（教员及以上）         |
| `/admin/<id>` | 一份卷子的题目（**这一页显示正确答案**） |

## 第一次上线

题库在 can-api 那边，所以顺序是：

```bash
# 在 can-api 仓库里
export DATABASE_URL='mysql://…'
bunx prisma db push --schema prisma/schema.prisma   # 四张新表
go run ./cmd/seed-exam                              # 把入网测试灌进题库

# 回到这里
kubectl apply -f deploy/k8s.yaml
```

跳过 `seed-exam` 站点也起得来，只是一场考试都列不出来 —— 题库是空的。

**加图片和多选之后，can-api 那边多了两步**，都在这个仓库之外：

1. 再 `prisma db push` 一次 —— `examQuestion` 多了 `multiple` 和 `imageUrl`，
   `examOption` 多了 `imageUrl`。**这一步要先于 can-api 部署**，否则它读题的
   SELECT 会撞上不存在的列。
2. 建一个 R2 桶、挂上 `cdn.ceruleanavi.net` 这个自定义域、开一只只对该桶有
   Object Read & Write 的 API 令牌，把那五项配进 can-api。不做这一步的话，站点
   一切正常，只是上传按钮会说图片存储没配。

## 和 can-web 的关系

can-web 的 `/exams/*` 还在原样跑着，调的是 can-api 那条固定卷路由。两套并行，等
这边稳定之后再谈迁移。

更深的东西在 `CLAUDE.md`：为什么一张卷子只能交一次、为什么发卷是 POST、为什么这
一侧一次授权判断都不做。
