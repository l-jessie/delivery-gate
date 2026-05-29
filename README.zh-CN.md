# Delivery Gate for OpenClaw（中文）

啊... 这是给openclaw的一个交付门禁过度插件。拒绝半成品。拒绝胡说

Delivery Gate 是一个 OpenClaw 运行时交付质量插件。它通过任务分类、证据账本、最终回复门禁、原生审批、长任务自主恢复、证据强度评分、业务 oracle 对比、changed-lines 追溯和文档语言一致性检查，减少 Agent 的假完成、弱验证和过早打断用户。

## 解决什么问题

- Agent 声称“完成了”，但没有验证证据。
- 弱证据被当成强业务验证。
- 代码改动没有 changed-lines 逐行追溯。
- 英文 README / 中文 README 的语言边界在修改中漂移。
- 涉及正确口径 / 旧逻辑 / 导出 / 正确接口时，没有做 oracle 或业务等价对比。
- 文件、配置、代码任务缺少读回、状态检查、测试或构建证据。
- 长任务遇到问题就直接问用户，而不是先自主查记忆、源码、日志、同项目参考或官方资料。
- 删除、发送、公开发布、付费、隐私敏感等高风险动作缺少显式确认。
- 长任务缺少可复盘的运行账本和计划文件。

## 核心行为

- 对每轮任务分类：简单问答、调研、文件产物、代码、配置/运行时、外部/破坏性动作。
- 在 prompt 构建前注入短策略，约束当前任务的交付标准。
- 记录每次工具调用证据到 per-run ledger。
- 对证据做强度评分，不只判断“有没有验证”。
- 代码任务要求 diff / test / build / lint / readback 等闭环证据。
- 代码 diff 要求 changed-lines / 逐行追溯证据。
- 任务命中业务 oracle 时，要求同源或等价验证证据。
- 检查文档语言一致性，例如避免中文正文写入 `README.md`，或英文正文写入 `README.zh-CN.md`。
- 最终回复前发现缺证据、弱证据、过早问用户或高风险处理不完整时，请求一次 bounded revision。
- 未确认的高风险外部/破坏性工具调用默认走 OpenClaw 原生 `requireApproval`。
- 长任务优先自主恢复：memory/wiki → 本地文档/源码/日志 → 同项目参考 → 官方/网络资料。
- 为项目/代码类长任务写入 `<workspace>/.openclaw/plans/`，便于复盘和后续接续。

## 默认隐私策略

- `ledgerPromptMode: "redacted"`：写 ledger / plan 前默认脱敏常见密钥、token、cookie、authorization 等内容。
- `reviewerMode: "rules"`：默认只用规则审查，不额外调用 LLM reviewer。
- ledger 支持大小轮转和保留天数。
- project plan 默认保留在项目 `.openclaw/plans/`，如果不想提交，应把 `.openclaw/` 加入业务项目 `.gitignore`。

## 给 AI Agent 的安装落地说明

当用户把这个仓库地址发给 AI，并要求它把 Delivery Gate 落地到 OpenClaw 时，AI 应在安全边界内自主完成安装、配置和验证；不要只给用户一段计划。

1. **先检查环境**
   - 确认本机已安装 OpenClaw，并定位当前生效的配置文件。
   - 修改配置前先查看 OpenClaw 插件 / 配置文档或 schema。
   - 如果已有 `plugins.entries.delivery-gate`，先读取当前配置，后续只做合并，不覆盖无关项。

2. **安装或更新插件源码**
   - 将仓库 clone 或复制到 OpenClaw 插件目录，常见位置：
     - `~/.openclaw/plugins/delivery-gate`
   - 在插件目录运行 `npm test`。
   - 不要提交运行产物：`runs/`、`plans/`、`.openclaw/`、`node_modules/`。

3. **启用 OpenClaw 插件配置**
   - 保留现有配置，只合并 `plugins.entries.delivery-gate`。
   - 推荐配置如下：

```jsonc
{
  "plugins": {
    "entries": {
      "delivery-gate": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "enabled": true,
          "mode": "revise",
          "strictTools": true,
          "longTaskMode": true,
          "projectPlanFiles": true,
          "cleanupPlanOnSuccess": false,
          "persistLedger": true,
          "ledgerPromptMode": "redacted",
          "reviewerMode": "rules",
          "approvalMode": "approval",
          "autonomousRecovery": true,
          "enforceAutonomousRecovery": true,
          "evidenceScoring": true,
          "oracleStrict": true,
          "changedLinesReview": true,
          "docLocaleConsistency": true
        }
      }
    }
  }
}
```

4. **重载并验证**
   - 只有本地配置机制需要时才重启 / reload OpenClaw。
   - 用 `openclaw plugins list` 验证 Delivery Gate 已启用并显示预期版本。
   - 做低风险探针：让某个 agent 报告 `<delivery_gate>` 注入块里的插件版本和任务分类。
   - 做负向探针：安全地模拟“声称完成但缺少读回 / 测试证据”的场景，确认 Delivery Gate 会要求 revise 或阻止假完成。

5. **交付时必须给证据**
   - 最终回复应包含：插件路径、修改的配置路径、版本号、`npm test` 输出、`openclaw plugins list` 证据、剩余风险。
   - 如果无法验证，不要说安装成功；明确标记缺少哪一步验证。

## 推荐配置

```jsonc
{
  "plugins": {
    "entries": {
      "delivery-gate": {
        "enabled": true,
        "hooks": {
          "allowPromptInjection": true,
          "allowConversationAccess": true
        },
        "config": {
          "enabled": true,
          "mode": "revise",
          "strictTools": true,
          "longTaskMode": true,
          "projectPlanFiles": true,
          "cleanupPlanOnSuccess": false,
          "persistLedger": true,
          "ledgerPromptMode": "redacted",
          "reviewerMode": "rules",
          "approvalMode": "approval",
          "autonomousRecovery": true,
          "enforceAutonomousRecovery": true,
          "evidenceScoring": true,
          "oracleStrict": true,
          "changedLinesReview": true,
          "docLocaleConsistency": true
        }
      }
    }
  }
}
```

## 关键配置说明

| 配置 | 默认 | 说明 |
|---|---:|---|
| `mode` | `revise` | final gate 失败时请求模型再修订一次；`observe` 只观察。 |
| `strictTools` | `true` | 启用工具证据门禁。 |
| `longTaskMode` | `true` | 启用长任务计划、里程碑反思和失败预算提示。 |
| `autonomousRecovery` | `true` | 长任务遇到非风险阻塞时，先自主查证再问用户。 |
| `enforceAutonomousRecovery` | `true` | 长任务过早问用户且缺少自主恢复证据时触发 revise。 |
| `evidenceScoring` | `true` | 启用证据强度评分和最低证据分。 |
| `oracleStrict` | `true` | 命中正确口径 / 旧逻辑 / 导出等 oracle 时要求等价验证。 |
| `changedLinesReview` | `true` | coding diff 后要求 changed-lines 逐行追溯证据。 |
| `docLocaleConsistency` | `true` | README 文档修改时检查语言边界，避免英文文档写中文正文、中文文档写英文正文。 |
| `approvalMode` | `approval` | 高风险动作默认走原生审批；可设为 `block` 硬拦截。 |
| `persistLedger` | `true` | 持久化 per-run ledger。 |
| `ledgerPromptMode` | `redacted` | ledger 中 prompt 脱敏策略：`none` / `redacted` / `full`。 |

## 当前开源状态

当前版本已经超过 MVP，属于本机可用的 RC / 0.7 阶段：

- 已有 smoke、unit matrix、hook simulation 测试。
- 已接入 OpenClaw 原生审批。
- 已有隐私默认值和发布元数据。
- 已完成模块化拆分，便于提交 git 和后续维护。

公开发布前建议继续补：

- 跨 OpenClaw 版本兼容测试。
- `npm pack` 后通过 OpenClaw npm-pack 安装验收。
- GitHub Actions / CI。
- 历史失败场景 replay 测试集。

## 测试

```bash
npm test
```

测试包含：

- `test/smoke.mjs`：manifest、版本和配置 schema 快速检查。
- `test/unit.mjs`：分类、证据评分、oracle、changed-lines、final revise 矩阵。
- `test/hook-sim.mjs`：模拟 OpenClaw hook 生命周期。

## 目录结构

```text
delivery-gate/
  index.js                  # 公开入口：re-export helper 和默认 plugin
  openclaw.plugin.json      # 插件 manifest 和 config schema
  package.json              # npm 元信息和测试脚本
  src/
    version.js              # 版本号
    config.js               # 配置默认值和边界处理
    utils.js                # 运行态 Map、run/session 工具函数
    classify.js             # prompt/tool 分类
    evidence.js             # 证据评分、oracle 检测、最终回复文本判断、脱敏/序列化
    guidance.js             # 注入给 Agent 的 delivery-gate 指令
    gate.js                 # final revise / blocking 决策矩阵
    persistence.js          # ledger、plan、approval 摘要
    plugin.js               # OpenClaw hook 注册
  test/
    smoke.mjs
    unit.mjs
    hook-sim.mjs
```

## 许可证

MIT
