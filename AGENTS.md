# 星愿 Dsh 插件开发文档

> 本文档描述独立项目 `@starwish-ai/xingyuan-dsh` 的架构、核心机制与开发规范，面向后续在本仓库上迭代的开发者。
> 接口基线：DeepSeek Harness（下称 dsh）`0.1.1-rc.2`。dsh 处于技术预览期，API 可能变动；
> 升级依赖版本前先核对官方 release notes 与 §12 参考文档。

---

## 1. 项目概览

星愿是一个愿望与习惯养成助手，以 dsh 插件组合包（bundle）+ Agent Preset 形式交付：
用户安装后执行 `dsh plugin --profile web add @starwish-ai/xingyuan-dsh`，
agent 选择器出现「星愿」即安装成功。

| 能力 | 实现位置 |
|---|---|
| 对话创建愿望/任务（含查重、推荐任务） | `src/preset/tools.ts`（45 个模型工具，见 §6） |
| 机会日打卡（周期计算、补卡、取消、未来预勾） | `src/opportunity.ts` + `src/store.ts` |
| 微行动拆解（3–7 步逐步完成/跳过/重开） | `src/micro.ts` |
| 记忆（增删改查 + 上下文自动注入） | `memories` 表 + `src/preset/prompts.ts` 动态上下文 |
| 成长体系（Lv.1–Lv.10、经验、连续加成） | `src/growth.ts` |
| 图表（15 种 chartKey，会话内卡片渲染） | `src/preset/charts.ts` + `xingyuan/chart` 事件 |
| 会话视图页（今日/愿望/任务/日历/成长/记忆六标签） | `src/client/pages/*`（client 半侧） |
| 安全确认（写操作二次确认、删除始终确认） | `src/preset/hitl.ts`（userQuestions） |
| 数据持久化 | 自带 sqlite 后端，`~/.dsh/xingyuan/xingyuan.sqlite` |

技术栈：TypeScript（Node ≥22.5）+ Cordis 插件框架 + React 18（client 半侧）
+ `node:sqlite` + zod；peer 依赖 `@deepseek-ai/*` 全部锁定 `^0.1.1-rc.2`。

### 运行形态

```
用户浏览器 ── dsh Web GUI（官方壳）
              ├─ Chat 流：会话事件卡（愿望/任务/打卡/图表/微行动）
              ├─ 会话视图标签页：今日/愿望/任务/日历/成长/记忆（client 模块注入 slots）
              ├─ 设置 → 星愿 设置页（教练风格/画像/确认开关/注入上限）
              └─ 浏览器直开页面 /xingyuan/today | /calendar | /growth（webServer 路由）
        dsh 进程（Node）
              ├─【bundle 层 · 常驻】自带 sqlite 后端行 + storage-domain 领域路由
              ├─【bundle 层 · 常驻】/xingyuan/* 页面与数据 API（src/routes/）
              ├─【bundle 层 · 常驻】preset 发布到用户根（src/preset-root.ts）
              └─【preset 层 · 选「星愿」才挂载】presets/xingyuan/agent.cordis.yml
                    → @starwish-ai/xingyuan-dsh/preset/side
                    （工具 + 11 段提示词 + HITL 确认 + 动态上下文）
```

分层铁律：**工具/提示词只注册在 preset 层**——未选择星愿的会话完全看不到它们，
不污染其他类型的会话。

## 2. dsh 术语速查

| dsh 概念 | 含义 | 星愿用法 |
|---|---|---|
| **Bundle 组合包** | npm 包，声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh plugin add` 安装 | `@starwish-ai/xingyuan-dsh` 本体 |
| **Cordis 插件** | `apply(ctx, config)` + `inject` 依赖声明 + effect 自动清理副作用 | 一切代码的组织单元 |
| **Agent Preset** | 会话级能力集合；目录含 `agent.cordis.yml`（具名插件行列表）+ 可选 `preset.yml`；id = 目录名 | 目录名 `xingyuan`；绑定星愿工具与提示词 |
| **Session Event** | 持久会话事件（`SessionEventMap`），模型可见即已记录，刷新可回放 | 承载 wish/task/checkin/chart/micro 业务事实 |
| **Conversation Node** | client 半侧按事件渲染聊天卡片的扩展点 | 五类业务卡片 |
| **storage domain** | `defineDomain` 声明表结构（zod），由存储后端落库 | 四张表 + global 单例 |
| **userQuestions** | 阻塞式人机问答 seam | 写操作二次确认 |

## 3. 目录结构与构建产物

```
XingYuan-Dsh/
├── package.json            # exports 子路径导出 + dsh.bundle/client 声明 + peer 锁版本
├── cordis.patch.yml        # bundle 层组合补丁（见 §4）
├── presets/xingyuan/
│   ├── agent.cordis.yml    # preset 组装：单行 → @starwish-ai/xingyuan-dsh/preset/side
│   └── preset.yml          # 展示元信息（name/description）
├── src/
│   ├── index.ts            # bundle 常驻入口：发布 preset → 开领域 → provide('xingyuan') → 注册路由
│   ├── domain.ts           # defineDomain 四张表 + global schema + XingyuanStore 服务
│   ├── sqlite.ts           # 自带 sqlite 存储后端（StorageBackend 契约实现）
│   ├── store.ts            # 业务层（愿望/任务/打卡用例，工具面与路由面共用收口）
│   ├── opportunity.ts      # 机会日计算器（once/daily/weekly/monthly + 月末钳制）
│   ├── growth.ts           # 等级经验与连续统计（从 checkins 重放重算）
│   ├── micro.ts            # 微行动状态机
│   ├── cascade.ts          # 删除级联（愿望→任务→打卡→微行动→颜色覆盖）
│   ├── category-color.ts   # 分类颜色解析（覆盖 > 显式 > 哈希兜底，22 键）
│   ├── events.ts           # SessionEventMap 声明合并（纯类型导出，host/client 共用）
│   ├── preset-root.ts      # 发布 preset 到 $DSH_HOME/.agent-presets/xingyuan（指纹幂等）
│   ├── routes/             # /xingyuan/* HTTP 面（index/api/config/errors/pages-html）
│   └── preset/             # ↓ 只挂在 preset 层 ↓
│       ├── side.ts         # preset 侧入口：设置节安装 + 工具/提示词注册
│       ├── tools.ts        # 45 个模型工具
│       ├── prompts.ts      # 11 段系统提示词 + 动态上下文
│       ├── hitl.ts         # userQuestions 确认封装
│       └── charts.ts       # 15 种 chartKey 数据计算
├── src/client/             # 浏览器半侧（React 18）
│   ├── index.ts            # 注册 5 个卡片 Definition + 6 个视图标签页 + 设置整页
│   ├── cards.ts / types.ts # keyed 渲染器与卡片状态
│   ├── pages/              # today/wishes/tasks/calendar/growth/memory/detail/quick-create/...
│   ├── ui.ts / styles.ts   # 应用内对话框、toast、主题样式
│   └── i18n.ts             # 中英双语字典
├── debug/                  # 视觉验证 mock 生成器（gen-mock.ts，用真实 STYLE_TEXT 产深/浅两主题静态页；见 §5.10）
└── test/                   # vitest：loader 级集成测试 + 各层单测（见 §9）
```

构建产物为 `lib/`（tsdown 打包 + tsc 类型）。集成测试依赖 `lib/` 产物，
因此本地跑测试前必须先 `pnpm build`（CI 已保证顺序）。

## 4. 分层与组合

三层职责：

| 层 | 组合方式 | 内容 | 卸载行为 |
|---|---|---|---|
| bundle 常驻层 | `cordis.patch.yml` 补丁宿主组装 | sqlite 后端行、主插件行、schedule 行、storage-domain 领域路由 | `dsh plugin remove` 连依赖带层一起拔除 |
| preset 发布 | 文件复制到用户根 | `presets/xingyuan/` 两文件 | 用户根残留目录不影响其他部署，可手动删除 |
| preset 层 | 选「星愿」agent 时才挂载 | 工具/提示词/HITL | 未选则整层不存在 |

### cordis.patch.yml（现状）

```yaml
# 语义：`- insert:` 插入新行；裸行按 id 整行替换既有配置（不深合并）。
- insert:
    - id: xingyuan-sqlite          # 自带 sqlite 后端，DB 固定 ~/.dsh/xingyuan/
      name: '@starwish-ai/xingyuan-dsh/sqlite'
      config:
        path: !!js "dshHomePath('xingyuan', 'xingyuan.sqlite')"
    - id: xy-bundle                # 主插件行：开领域 + 提供 xingyuan 服务 + 注册路由
      name: '@starwish-ai/xingyuan-dsh'
    - id: schedule                 # 宿主默认组装不含 schedule 行，需补插
      name: '@deepseek-ai/dsh-schedule'
# 领域路由：星愿领域走 sqlite，其余领域维持 json（整行替换须重述 backend）
- id: storage-domain
  name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
    routes:
      xingyuan: sqlite
```

两个硬约束（踩过的坑，勿改回去）：

1. **主行 id 不能与 preset 目录名同名**。两者都叫 `xingyuan` 时会话挂载 preset 会死锁，
   故主行 id 用 `xy-bundle` 加以区分。
2. **DB 路径禁止放进包安装目录**——卸载/升级均可能清掉包目录；固定在 `~/.dsh/xingyuan/`
   才能保证数据存活。备份只需拷贝该目录。

### preset 发布机制（preset-root.ts）

为什么不通过 patch 把包内目录加进 agent-presets roots：CLI profile-boot 会用自带的
SHIPPED_PRESET_ROOT **整体覆盖 agent-presets 行的 roots 键**，bundle 层无法追加根目录。
因此采用「激活期把 preset 目录复制到用户根 `$DSH_HOME/.agent-presets/xingyuan`」：

- 用户根是官方 roster 的常备扫描位（includeUserRoot 默认 true），复制即生效；
- 以两份源文件内容的 sha256 指纹做 `.xingyuan-version` 标记，内容变才重拷，
  HMR 重载零成本，升级自然幂等；
- `agent.cordis.yml` 里的行用**裸包名子路径导出**
  （`- name: '@starwish-ai/xingyuan-dsh/preset/side'`），模块解析跟随宿主组装基准，
  与该文件被复制到哪里无关。

## 5. 核心机制

### 5.1 存储领域（domain.ts）

```ts
export const DOMAIN_VERSION = 1

export const xingyuanDomainSpec = defineDomain({
  name: 'xingyuan',
  version: DOMAIN_VERSION,
  global: {                       // 全局单例槽：教练风格 + 用户画像 + 微行动状态 + 分类色覆盖
    schema: GlobalSchema,
    initial: { coachStyle: 'gentle', profile: {} },
  },
  tables: {
    wishes:   domainTable(z.object({ wishId, title(≤50), categoryName(2..6), colorKey?,
                                      description?, estimatedCompletionDate?, progress,
                                      totalRequiredDays, totalCompletedDays, archived, createdAt })),
    tasks:    domainTable(z.object({ taskId, wishId?, name(≤100), hint?, dueDate?,
                                      checkInCycle: enum(['once','daily','weekly','monthly']),
                                      source: enum(['user','ai']), status, claimDate?,
                                      requiredDays, completedDays, closedReason?, createdAt })),
    checkins: domainTable(z.object({ checkinId, taskId, date, checkedAt })),
    memories: domainTable(z.object({ key(2..50), value(≤1000),
                                      category: enum(['personal','preference','habit','event','other']),
                                      importance: enum(['high','medium','low']), createdAt:number })),
  },
})
```

要点：

- **无迁移机制**：介质版本不符直接拒绝打开。`DOMAIN_VERSION` v1 一次定死；
  演进策略 = 版本号递增 + 重导出工具（从 v1 规划）。global 里新增字段一律声明
  `optional`——zod 对旧数据缺键解析为 undefined 即向后兼容，无需动版本号。
- **规避「无二级索引」限制**：每 key 一文档一物理行，跨表无事务、无索引。
  打卡表以 `` `${taskId}|${date}` `` 复合键存取，O(1) 判存在；「某任务的机会日序列」
  不逐日展开落库，由 `opportunity.ts` 按需现算。
- **自带 sqlite 后端**（`sqlite.ts`）：实现 dsh-storage `StorageBackend` 契约。
  物理布局为一个 DB 文件：`xingyuan_meta(unit, version)` 戳介质版本并承载 global 槽；
  每张声明表一张物理表 `u_<unit>_<table>`（key TEXT PRIMARY KEY, value TEXT JSON）。
  `node:sqlite` 同步写 + WAL，写入即持久。
- **生命周期**：bundle 入口先 `ensurePresetRoot()` 再 `storageDomain.open(spec)`，
  就绪后 `ctx.provide('xingyuan', store)`；`ctx.effect(() => async () => domain.close())`
  保证卸载/HMR 自动关闭。注意：异步 await 间隙访问 `ctx.*` 会命中 inactive context，
  服务引用必须在 apply 同步段取出。

### 5.2 打卡与机会日语义（领域口径，改前必读）

机会日 = 任务应打卡的日期序列，是打卡/进度/日历/完成判定的唯一事实口径
（`src/opportunity.ts`，配套 `test/opportunity.test.ts` 覆盖边界用例）：

- **锚点日** = 领取日（claimDate），未领取则为创建日；延迟领取锚点随领取日后移，
  requiredDays 同口径重算。
- **周期**：`once` 仅截止日一天；`daily` 锚点日起每天；`weekly` 每 7 天（非自然周）；
  `monthly` 逐自然月推进并做日期钳制（1/31 → 2/28 → 3/31）。
- 全部日期为本地时区 `yyyy-MM-dd` 字符串，ISO 字典序即时间序；内部换算用 UTC 天数序号，
  规避夏令时漂移。
- 无截止日的任务没有机会日约束（不限次数）。

打卡规则（`check_in_task` 工具描述与页面文案同源）：

1. 不传日期 = 自动勾选今天（含）起**最早未勾选**的机会日；
2. 过去的日期不会自动补，补卡须指定日期（日历页入口）；
3. 今天不是机会日时勾选的是未来日期——**提前打卡 = 承诺当天完成**，回复须如实告知；
4. 取消打卡可指定日期撤销；一次打卡对应一个机会日。

进度口径：愿望进度 = 应打天数完成率；任务的 requiredDays/completedDays 由机会日序列与
checkins 表推导，跨天恒为最新（不冗余存储历史状态）。

### 5.3 成长体系（growth.ts）

- 全部指标从 checkins 表**重放重算**（单一事实源）：取消中间一天、乱序补卡、同日多条、
  未来预勾均精确无漂移。
- 经验 = 每条打卡记录发 10 点基础分 × 该记录所在日期的连续加成（≥3 天 ×1.2、≥7 天 ×1.5，
  四舍五入）；同日多条共享同一连续值。
- 当前连续 = 从最后一条 ≤ today 的记录倒推的自然日连续，断更后**冻结不衰减**；
  未来预勾只计入累计/最长/经验，不劫持当前连续。
- 等级 Lv.1 初心者 → Lv.10 星愿大师，累计经验阈值 0/100/300/600/1000/1500/2200/3000/4000/5200。

### 5.4 模型工具（preset/tools.ts）

注册模式（全部 45 个工具一致）：

```ts
ctx.tools.register(defineTool({
  name: 'check_in_task',
  description: '任务打卡。……',          // 何时使用/语义边界写全，模型靠它决策
  parameters: {                          // ValueSchemaSpec DSL；enum 表达枚举，不裸写 JSON Schema
    taskId: { type: 'string', required: true },
    checkInDate: { type: 'string', description: 'yyyy-MM-dd，可选' },
  },
  output: TEXT_OUTPUT,                   // output.render 只产模型文本；UI 状态走会话事件
  timeoutMs: 600_000,                    // HITL 等待类工具声明超时即承诺协作取消
  async execute(args, exec) {
    // 写库 → agent?.session.append('xingyuan/*', 事件) → 回纯文本结论
  },
}))
```

规范要点：

- 并发安全缺省 = 互斥；仅纯读工具显式标 `isConcurrencySafe: true`。
- `execute` 必须观察 `exec.signal` 并转发给可中断的底层调用。
- ID 引用纪律写进每个工具描述：ID 必须取列表返回的真实值，模糊指代先查列表定位。
- 部分更新原则：update 类工具只接受用户明确提及的字段，未提及不传、禁止编造；
  可选字段传**空字符串**表示清除（任务 hint/dueDate，愿望 描述/颜色键/预计完成日）。
- 业务写入统一走 `store.ts` 用例（createWish/updateWish/createTask/updateTask/打卡族/cascade），
  工具面与 `/xingyuan/*` 路由动作共用同一收口——校验、级联、进度联动只有一份实现；
  读侧（freshTask/freshWish/planForDay/图表）一律新鲜化，按钮态与写路径校验同口径。
- 内部工具约定：`generate_chart`、`batch_query_user_data` 为模型辅助查询，
  成功结果经图表事件/汇总回包呈现；描述中注明回复口径约束。

### 5.5 HITL 写确认（preset/hitl.ts）

语义矩阵：

| 操作 | 是否确认 |
|---|---|
| 创建 / 打卡 / 取消打卡 | 受设置「写操作二次确认」开关控制（默认开） |
| 删除（单个/批量） | 始终确认（不可关） |
| 教练风格 / 用户画像修改 | 免确认 |
| 记忆保存 / 更新 | 免确认（有意的零摩擦采集；删除记忆仍走上行「始终确认」） |

实现契约（dsh-user-questions 校验过的事实）：

- ask() 的 `plan-review` 意图要求 `detail` 携带被审阅的计划文本，缺 detail 抛 BAD_INTENT；
  星愿的动作确认不是计划审批，**不挂意图标签**，走通用选项列表（answer 协议一致）。
- headless 无 live agent 时直接放行（一次指令跑完的语义）；有 agent 但环境未注册 UI
  provider（NO_PROVIDER）时同样放行——确认卡是 Web GUI 交互面，无界面场景下
  任务文本本身即用户指令。
- `confirmWrites` 开关读取走 getter（设置热改后下一次 execute 立即生效，HMR 安全）。

### 5.6 会话事件与 UI 卡片（events.ts / client/）

星愿采用 **whole-value 单事件模式**：每条事件携带完整展示状态，一张事件一张卡片，
内部 id 直接用 `event.seq`，天然满足「每 (kind,id) 仅一条 start」的不变量，
无需 start/delta 配对与确定性拼接逻辑。

五个事件 kind（生产方 `events.ts` 声明合并，host 侧经 `exec.agent.session.append(kind, data)`
发出；每张卡在刷新/回放后仍然可见）：

| kind | 载荷要点 |
|---|---|
| `xingyuan/wish` | op(created/updated/deleted) + 愿望快照 |
| `xingyuan/task` | op + 任务快照 + 未来机会日预览（≤5 个） |
| `xingyuan/checkin` | checked/cancelled + 任务名 + 日期 + 进度计数 |
| `xingyuan/chart` | chartKey + title + chartType(line/column/bar/pie/arcbars/heatmap/radar) + 数据点 |
| `xingyuan/micro` | started/stepped/restarted/finished + 步骤数组 + currentStepNumber |

client 半侧注册三处声明合并位 + 一个 Definition 工厂：

```ts
// src/client/index.ts —— 三个官方类型合并点缺一不可
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap { 'xy-wish': XyState; /* …共 5 个 */ }
}
declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap { 'xy-wish': XyState; /* …共 5 个 */ }
}
```

Definition 按 `KIND_BY_EVENT` 把 `xingyuan/*` 映射到 `xy-*` kind，
`match/start/update` 渲染器只读 `node.data`（whole-value），不扫描事件窗口。

注意：dsh 工具内建的 UI 卡片是固定五词汇（generic/terminal/diff/search/web），
不支持任意自定义 React 卡——业务卡片一律走 ConversationNode，人机确认走 userQuestions，
这是官方分工，不要试图扩展前者。

### 5.7 系统提示词与动态上下文（preset/prompts.ts）

静态分节 11 段（`ctx.systemPrompt.section({ name, order, text })`）：
identity(order 5)、capabilities/patterns/examples/constraints(101–104)、
wish-guide/task-guide/memory-guide/config-guide/chart-guide/reminder-guide(110–115)。

动态上下文三处（`ctx.systemPrompt.context({ name, order, text })`，text 为 provider 函数，
每次轮次求值）：

| name | order | 内容 |
|---|---|---|
| xingyuan:coach-tone | 20 | 按当前教练风格切换语气模板 |
| xingyuan:memories | 21 | `<user_profile>` 块：画像 + 高/中重要性记忆（按 memoryInjectLimit 截断，超量标注可用 search_memory 检索） |
| xingyuan:today | 22 | 开场「今日应打卡 N 条」概览 |

关键行为准则已写入 identity/constraints：执行操作类工具后必须一句话明确告知结果；
预工具叙述在工具回合结束丢弃属于 dsh 轮次流程天然行为，无需额外处理。

### 5.8 设置卡（preset/side.ts ↔ client/pages/settings.ts）

- preset 侧：`settingsNamespace('xingyuan')` 定义命名空间，
  `installSettingsSection(ctx, NS, Config, config, { setSource, onChange })` 安装；
  工具侧持 getter 对象读 `source()`，设置热改后即时生效，无需重建注册。
- client 侧：设置整页读写同一 namespace（settingsScope）。
- 官方限制：设置卡本质是 schemastery 表单，无自定义按钮——引导闭环必须 chat-first，
  复杂交互（应用内确认对话框/toast）做在 client 半侧 `ui.ts`。

### 5.9 HTTP 路由（routes/）

`webServer.register({ kind: 'prefix', path: '/xingyuan' })` 统一分发：

- GET 页面（自包含 HTML，无 GUI 场景 URL 直开）：`/`、`/today`、`/calendar`、`/growth`
- GET 数据：overview / day / range / calendar / growth / wishes / tasks / profile /
  memories / task-detail / categories
- POST 动作：checkin / cancel-checkin / claim / profile / memory-add / memory-delete /
  memory-clear / create-wish / create-task / delete-task / delete-wish /
  category-rename / category-color

错误协议：`HttpError` 按状态码直出；`ActionError` 返回 400 携带 `error/code/params`
（code 供客户端本地化）；其余 Error 按 400 返回领域校验消息，带稳定 code 的领域错误
原样透传。请求体上限 64KB。

### 5.10 客户端半侧开发纪律（视觉与验证踩坑沉淀）

**API 请求 URL 拼接**：带 query 参数的请求一律 `URLSearchParams` 统一构造，
禁止手工字符串拼接；同资源的多条取数路径（首屏 / 加载更多）必须共用同一个
URL 构造函数。背景：记忆页搜索曾把 URL 拼成 `?q=词?offset=0`（第二个分隔符
误用 `?`），服务端把「词?offset=0」整体当关键词，用户症状是「搜索永远为空」；
现由 `memoryListUrl()` 收口 + `test/client-pages.test.ts` 回归锁死。

**任务详情操作区**（`detail.ts`，愿望页/任务页共用）：按钮单行成组，顺序 =
主操作（打卡/领取）→ 条件动作（取消打卡）→ 辅助（让 AI 总结）→ 危险（删除）；
危险删除不用 `margin-left:auto` 右漂——窄面板里是一段突兀空白，愿望卡内还会与
卡头的愿望级删除同侧对齐造成语义混淆，靠 danger 描边 + 确认弹窗区分即可；
不重复 TaskLine 行已展示的元信息（cycle/duration 等）；详情底部恒留 8px 呼吸
（`xy-taskrow` 场景覆盖为 2px，分组卡行自带 11px 内边距），操作按钮不得与
下一条任务的分割线贴死；详情每段「标签 → 内容」固定纵向节奏
（`.xy-detail>div` gap 5px，段间 10px）。

**打卡记录周对齐网格**（`detail.ts`）：近 28 个机会日按周一始 7 列 CSS Grid 排布
（与日历页表头同构，GitHub/Streaks 惯例）——首格前按星期序补 `.xy-dcell-blank`
隐形占位（真实数据按机会日稀疏返回，错位是常态），今日格加 `xy-dcell-today`
accent 环（与日历圆章 today 环同一语法）；禁改回流式 flex-wrap（换行参差、
连续性不可读）。读屏口径不变：格子 aria-hidden + 容器 role=img 一句汇总。

**行内低频动作图标化**：长列表里重复出现的编辑/删除用 `.xy-btn-icon` 图标幽灵键
（26px 方形命中目标，线稿 SVG 走 `ui.ts` 的 `IconEdit`/`IconTrash`——勿再加
emoji 或新引图标库；新增功能图标优先复用线稿语言扩展 ui.ts）；文字语义全部
由 aria-label「动作 · 条目名」承担。适用：愿望卡头删除、记忆行编辑/删除。
详情操作区的「删除」保持文字按钮不变（与主操作并排成组，非列表重复场景）。

**元信息冗余裁剪**：TaskLine 的状态词仅在无旁证时保留（已完结）——进行中/
待领取的状态由同行的打卡/领取按钮自解释，任务页还叠加状态分组头；同理
成长页统计仅「当前连续」用强调卡突出（streak 是习惯类 App 的英雄指标），
其余统计数字用主文字色；缺省值显示本地化文案（`growth.stat.none`）且走
`xy-statcard-muted` 弱化，不用「—」占位。

**展示性日期一律 Intl 本地化**（`format.ts` 三档，禁在界面裸奔 ISO）：
短格式 `formatShortDate`（按钮/密集元信息/机会日列表）、友好全称
`formatFriendlyDate`（今日页标题、日历面板头，含星期）、中格式
`formatMediumDate`（愿望预计完成日等远期目标，带年份）；ISO 仅保留给
确认弹窗文案与读屏 aria（精度优先）。en 语序差异由 helper 内部处理。

**日历视觉语法**：无边框连续网格 + 日期圆章（`.xy-daynum`）承载状态——
待打卡=中性计划底（高频状态不作警示色）、部分完成=柔和琥珀、全部完成=柔和绿；
today=圆章蓝环（不覆盖状态底色，「今天该打卡」的提示不能被吃掉）、选中=圆章
实底（短暂即时反馈）；邻月补位=低透明度数字；月份导航成组居中，「回到本月」
贴右缘（≤520px 媒体查询改随流避免相撞）。改日历先读 `styles.ts`「日历」段注释。

**视觉改版验证回路**：客户端 React 页面无法脱离 dsh 壳运行，视觉改动不接受
「改完即完事」——用 `npx vite-node debug/gen-mock.ts` 生成深/浅两主题静态 mock
（真实 `STYLE_TEXT` + 手写镜像 DOM，含日历/愿望卡/任务卡三个场景），本地静态
服务 + 浏览器截图核对后才算完成。mock 的 markup 是 tsx 输出的手写镜像，仅用于
视觉核对；对应组件结构变更时必须同步 `debug/gen-mock.ts`。

**本地部署验证**：profile 内安装副本是**实体拷贝**（pnpm 装的 npm 包，非软链），
仓库改动不会自动生效。开发自验回路：`pnpm build` → 把 `lib/`（动了包声明再加
`package.json`）覆盖到 `~/.dsh/profiles/web/node_modules/@starwish-ai/xingyuan-dsh/`
→ 重启 `dsh web` → 浏览器强刷（Ctrl+F5，client JS 有缓存）。注意：
`dsh plugin add/update` 会用 npm 版覆盖该副本；数据无虞，库固定在
`~/.dsh/xingyuan/`（§4 硬约束 2）。

## 6. 工具清单（45 个）

改动工具面时对照此表增删（新增务必同步 prompts.ts 能力段落与 README 功能列表）。

**愿望（13）**

| 工具 | 说明 |
|---|---|
| check_similar_wishes | 创建前相似愿望查重（防重复核心体验） |
| create_wish_with_tasks / create_wish | 创建愿望；前者附推荐任务（默认 3 个，确认卡可删减） |
| get_wish_list / search_wishes / get_latest_wish / get_wish_detail | 读操作，并发安全 |
| list_wish_categories / list_wish_category_color_keys | 分类与 22 色键枚举 |
| update_wish / rename_wish_category | 部分更新；改名联动迁移颜色覆盖键 |
| delete_wish / batch_delete_wishes | 删除（始终确认；级联清理下属任务/打卡/微行动/颜色覆盖） |

**任务（16）**

| 工具 | 说明 |
|---|---|
| check_similar_tasks | 相似任务查重 |
| create_task / batch_create_tasks | 创建；批量联动愿望进度 |
| get_task_list / get_today_unchecked_tasks / get_today_checked_tasks / get_tasks_for_date / get_tasks_for_next_days / get_tasks_for_date_range / get_recommended_tasks | 各时间窗查询与推荐 |
| claim_task | 领取（锚点日变为领取日，联动愿望进度） |
| update_task | 部分更新 |
| check_in_task / cancel_check_in_task | 打卡/撤卡（§5.2 语义） |
| delete_task / batch_delete_tasks | 删除（始终确认，级联清理打卡与微行动） |

**微行动（3）**

| 工具 | 说明 |
|---|---|
| start_micro_action | 拆解 3–7 小步 |
| complete_micro_step | 完成/跳过当前步 |
| restart_micro_action | 重开（需确认） |

**记忆（6）**

save_memory / update_memory / search_memory / get_memory / get_all_memories / delete_memory

**用户配置（4）**

get_coach_config / update_coach_style / get_profile / update_profile（免确认，即时入 global 槽）

**统计（3，其中两个为内部工具）**

generate_chart（chartKey 15 选 1）、batch_query_user_data（全量汇总 + truncated 标注）、
get_growth_stats（等级/经验/连续/达成）

## 7. 图表 chartKey 枚举（15 种，勿随意改名）

`checkinTrend / checkinCalendar / taskCompletionRate / checkinRateTrend / weekComparison /
taskStatus / checkinByCategory / wishCategory / checkinRanking / taskDistribution /
wishProgress / wishAchievement / continuousCheckin / checkinTimeDistribution / weeklyActivity`

数据全部由 storageDomain 现算（`charts.ts`），卡片经 `xingyuan/chart` 事件渲染；
趋势类默认 14 天窗、分布类 30 天、上限 90，均可配（§8 配置面）。

## 8. 可配置项一览

配置哲学：无硬编码可调参数，默认值全部写进同名 schemastery schema（加载期校验失败响亮报错）。

| 来源 | 字段（默认值） |
|---|---|
| bundle 主行 Config | rangeDefaultDays(7)、rangeMaxDays(31)、memoryListLimit(500) |
| preset side Config（同时映射为 Web 设置页表单项） | memoryInjectLimit(40)、batchWishLimit(50)、batchTaskLimit(100)、chartTrendDays(14)、chartDistributionDays(30)、chartMaxDays(90)、chartRankLimit(10)、chartRankMax(20)、confirmWrites(true) |

配置变更触发 HMR 热替换；不做任何跨重载的模块级单例状态。

## 9. 构建、测试与发布

```sh
pnpm install
pnpm build     # tsc + tsdown，产出 lib/（集成测试依赖它，先 build 后 test）
pnpm typecheck
pnpm test      # vitest run
```

测试分层（`test/`）：

- **loader 级组合启动**：真实 cordis Loader 加载完整组合，断言工具注册、落库与回包
  （产品可见插件的门禁要求，手动 ctx.plugin() 不算数）；每个注册贡献附带 dispose 断言。
- **机会日对拍**：daily/weekly/monthly/deadline、月末钳制、乱序补卡等边界用例。
- **包装完整性门禁**：package.json exports 子路径与 dsh.bundle.patch 声明的每个目标
  文件必须存在于 lib/ 产物（`package-exports.test.ts`；./routes 曾指向不存在的
  lib/routes.js，外部子路径导入会失败而宿主运行时不走该子路径，故静默）。
- 客户端页面纯函数回归：跨取数路径共用的构造函数（如记忆列表 URL）以
  「构造 → 服务端往返命中」闭环锁定（`client-pages.test.ts`）。
- 业务层/工具层/路由层用例：创建→领取→打卡链路、删除级联不留孤儿、写确认门闩、
  延迟领取锚点重算、分类改名迁移颜色覆盖键、微行动状态机、成长聚合。

CI（`.github/workflows/ci.yml`）：typecheck → build → test（Node 22 + pnpm 10）。
发布（`release.yml`）：推送 `v*` tag 自动 build + test + npm publish（预发布版本挂 alpha tag，
npm provenance 开启）。

新增第三方构建依赖时遵守 purity 门禁：不允许跨插件值导入（peer 依赖除外）。

## 10. 设计决策摘要

延续项目立项时的定向结论，后续演进不得无声推翻：

1. **平行形态**：本仓库是独立 npm 包，其他形态的星愿版本各自演进；数据完全独立，不做互通。
2. **数据边界**：一切业务数据本地 SQLite（`~/.dsh/xingyuan/`），备份 = 拷贝目录；
   卸载/升级数据存活。
3. **多会话解耦**：业务状态全在存储层，会话只是访问入口；新开会话无缝续接，
   「今日应打卡」概览兜底提醒触达。
4. **Preset 可选不默认**：工具只挂 preset 层，agent 选择器手动选择；空白会话才能切换 preset。
5. **BYOK 复用 harness**：模型凭据使用自带「设置 → 模型」，不自建引导流。
6. **chat-first**：引导与教学在对话里完成；设置卡只承载偏好表单。
7. **周期提醒不做**：dsh schedule 只有一次性规则（at / every_seconds ≥300s 固定速率，
   锚定创建时刻），无 daily/weekly/monthly 日历能力；v1 以今日页 + 开场概览兜底，
   向用户的差异如实说明。（另注：schedule 工具只对装载之后新建的 live 根 agent 可见。）
8. **写确认默认开**：创建/打卡/取消受开关控制，删除始终确认（§5.5 矩阵）。

## 11. 已知限制

- dsh schedule 仅 session-local：提醒只在承载它的会话存活期内触达，到期以
  `[SCHEDULE REMINDER]` 用户角色 follow-up 呈现，无专属 UI。
- 设置卡是 schemastery 表单，无自定义按钮/复杂控件。
- 存储无迁移机制：领域 schema 只能用 optional 字段做向后兼容增量；破坏性演进必须升
  DOMAIN_VERSION 并提供数据重导出方案。
- 会话事件要求每 (kind,id) 仅一条 start——新事件类型沿用 whole-value 单事件模式最省心。
- 主行 id 与 preset 目录名避让、roots 不能 patch 追加（§4 两个硬约束）。
- dsh 技术预览期升级锁版本 `0.1.1-rc.2`；跨版本升级前核对 release notes 与排障索引。

## 12. 官方参考文档

文档站入口：<https://deepseek-harness.github.io/deepseek-harness/>（SPA，栏目内导航浏览）。
以下深链指向源码仓库 `docs/`（2026-08-27 逐一核验存在；`.zh.md` 为中文版）：

**入门 / BYOK**

- 快速开始：`https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/index.zh.md`
- 配置模型（providers）：`…/docs/user/guide/providers.zh.md`

**基础开发（日常迭代必读）**

- 第一个插件：`…/docs/user/develop/basic/index.zh.md`
- 开发一个 Tool：`…/docs/user/develop/basic/tool.zh.md`
- 插件配置：`…/docs/user/develop/basic/config.zh.md`
- 打包与安装（bundle/profile/层顺序）：`…/docs/user/develop/basic/publish.zh.md`
- 生命周期与 effect 清理：`…/docs/user/develop/framework/index.zh.md`
- 服务与依赖：`…/docs/user/develop/framework/service.zh.md`
- 事件系统：`…/docs/user/develop/framework/events.zh.md`

**Cordis 教程（七篇）**：`…/docs/cordis-tutorial/01-first-plugin.zh.md` 起

**概念参考**

- 架构总览：`…/docs/architecture.zh.md`
- Cordis 入门：`…/docs/cordis-primer.zh.md`
- 能力服务 seam：`…/docs/capability-seams.zh.md`
- Agent 生命周期：`…/docs/agent-lifecycle.zh.md`
- Tool 执行流水线：`…/docs/tool-execution-pipeline.zh.md`
- 测试规范：`…/docs/testing.zh.md`
- 术语表：`…/docs/glossary.zh.md`

**子系统（本项目用到的高频篇目，均在 `…/docs/subsystems/` 下）**

tools · storage · persistence · system-prompt · user-questions · approval · schedule ·
web-server · client-modules · settings · credentials · session · scope · invariants
（对应 `<name>.zh.md`；总目录见 `subsystems/README.zh.md`）

**Cookbook**（均在 `…/docs/cookbook/` 下）

adding-a-package · adding-a-tool · adding-a-conversation-node · adding-a-settings-card ·
extension-cookbook

**生成式参考**

- 配置目录（含 dsh-agent-presets 等）：`…/docs/config-catalog.zh.md`
- Tool Schema 目录：`…/docs/tool-catalog.zh.md`
- 持久化事件目录：`…/docs/persistence-catalog.zh.md`

**Agent Preset 格式权威出处**

`https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/preset/agent-presets/README.zh.md`

（以上表格语境中 `…/` 代指 `https://github.com/deepseek-ai/deepseek-harness/blob/main/`。）

### 排障索引

| 症状 | 先查 |
|---|---|
| 装不上 / git 安装缺 lib / prepare 授权失败 | docs/user/develop/basic/publish |
| 配置不生效 / 行被覆盖 | publish 的层顺序与「整行替换」语义；cordis.patch.yml |
| 实际组合与预期不符 | `dsh --dump-config` 看最终层叠结果 |
| 工具没出现在模型请求里 | subsystems/tools；preset 是否真的挂载（选了「星愿」吗；空白会话才能切） |
| INVALID_ARGS / 参数被拒 | ValueSchemaSpec DSL 的 additionalProperties/enum 要求；tool-catalog |
| 卡片不渲染 / 刷新后丢失 | cookbook/adding-a-conversation-node（start 唯一、确定性回放）；三个声明合并位是否齐全 |
| 会话事件没落盘 | exec.agent 是否存在（headless 无 agent 时 append 是 no-op） |
| 提醒没触发 / 周期提醒做不到 | subsystems/schedule（session-local、无日历规则、只装新建 live agent） |
| 数据库打开报版本不符 | subsystems/storage；DOMAIN_VERSION 策略 |
| preset 不出现 / mount 拒绝 | packages/preset/agent-presets/README.zh.md（realm 规则、roots 扫描时机） |
| HMR 后状态丢失 / 注册残留 | lifecycle effect 清理；是否存在跨重载模块级单例 |
| client 卡片/标签页没加载 | subsystems/client-modules（manifest/export/inject 三要素）+ files 清单 |
| 设置卡不显示 | cookbook/adding-a-settings-card（namespace 配对、双半侧导出） |
| Key/模型问题 | user/guide/providers；subsystems/credentials |
