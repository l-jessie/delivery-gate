import { norm, textOf } from './utils.js';
import { hasDocLocaleIssueFromText } from './evidence.js';

export function classifyPrompt(prompt = '') {
  let taskType = 'general';
  let risk = 'normal';

  const looksResearch = /(搜索|查询|调研|看看|文档|资料|release|版本|是否|对比|总结|解释|帖子|github|http)/i.test(prompt);
  const looksRuntimeMutation = /(配置|config|重启|restart|启用|禁用|安装|升级|修改|修复|服务|daemon|cron|contextengine|auth|provider|model)/i.test(prompt);
  if (/(代码|bug|接口|controller|service|mapper|编译|构建|测试|lint|maven|npm|vue|java|sql|重构|修复.*报错|实现.*功能|写代码|coding|code|build|test|compile|refactor)/i.test(prompt)) taskType = 'coding';
  else if (looksResearch && !looksRuntimeMutation) taskType = 'research';
  else if (/(openclaw|gateway|插件|plugin|配置|config|重启|restart|服务|daemon|cron|定时|memory|contextengine|auth|provider|model)/i.test(prompt)) taskType = 'config-runtime';
  else if (/(创建|新建|写入|修改|编辑|保存|生成).*(文件|txt|md|json|csv|excel|xlsx|sql|脚本|报告|数据)|下载目录|downloads|[\w.-]+\.(txt|md|json|csv|xlsx|sql|py|js|ts|java|vue)/i.test(prompt)) taskType = 'file-artifact';
  else if (looksResearch) taskType = 'research';
  else if (/(发送|发给|群发|发布|邮件|message|telegram|删除|remove|rm |付费|购买|公开|上传)/i.test(prompt)) taskType = 'external-action';
  else if (prompt.length < 80 && !/(检查|创建|修改|运行|执行|安装|配置|搜索|生成)/i.test(prompt)) taskType = 'simple-qa';

  if (/(删除|remove|rm |覆盖|overwrite|公开|发布|发送|群发|付费|购买|密钥|token|password|cookie|私钥|重启|gateway|config|cron|系统|服务)/i.test(prompt)) risk = 'high';
  const longTask = prompt.length > 180 || /(整体|重构|迁移|排查|诊断|优化|强化|升级|实现|修复|对比|完整|批量|多步骤|长任务|项目|代码库|全量|端到端|闭环|验证.*修复|先.*再.*最后)/i.test(prompt);
  return { taskType, risk, longTask };
}

export function classifyTool(toolName, params, result, error) {
  const t = norm(toolName);
  const p = textOf(params).toLowerCase();
  const r = textOf(result).toLowerCase();
  const c = `${t} ${p} ${r}`;
  const commandOnly = `${t} ${p}`;
  const commandWithoutHereDoc = commandOnly
    .replace(/cat\s+>[^&|;]+<<['\"]?(\w+)['\"]?[\s\S]*?\n\1/g, 'WRITE_HEREDOC')
    .replace(/<<['\"]?(\w+)['\"]?[\s\S]*?\n\1/g, '<<HEREDOC');
  const commandText = commandWithoutHereDoc;
  const inspectionIntent = /grep|rg |sed -n|cat\s+(?!>)|read|status|list|find |logs?|--help|view|inspect|查询|检查/.test(commandText) && !/\brm\s|send|发送|config\.apply/.test(commandText);
  const destructiveIntent = !inspectionIntent && /\brm\s+-|\brm\s|delete|remove|删除|覆盖|overwrite|publish|公开|发送|send|付费|购买|config\.apply|cron.*remove/.test(commandText);
  const write = /^(write|edit|message|cron|image_generate|video_generate|music_generate|tts)$/.test(t)
    || (/^gateway$/.test(t) && /config\.patch|config\.apply|restart|update\.run/.test(commandText))
    || destructiveIntent
    || /config\.patch|config\.apply|restart|action":"send|kind":"fill|kind":"click|kind":"type|cat >|tee |>|mv /.test(commandText);
  const read = /^(read|memory_get|wiki_get|sessions_history|session_status|pdf|image)$/.test(t)
    || t.includes('search') || t.includes('fetch') || t.includes('status') || t.includes('list') || t === 'browser' || t === 'gateway' || /cat\s+(?!>)|grep|ls |stat |wc |find /.test(commandText);
  const artifact = /\.json|\.csv|\.xlsx|\.sql|\.txt|\.md|excel|report|导出|报表|downloads|下载目录/.test(commandOnly);
  const dangerous = destructiveIntent || (!inspectionIntent && /trash|publish|公开|付费|购买/.test(commandText));
  return {
    read,
    write,
    verify: /test|lint|build|compile|doctor|status|logs?|grep|diff|git diff|mvn|npm test|pytest|node -|verify|检查|验证|读回|stat |wc |cat\s+(?!>)/.test(commandWithoutHereDoc) || /verified|passed|ok[:=]true|验证通过/.test(r),
    status: /status|doctor|logs?|health|list|runs|console/.test(commandWithoutHereDoc),
    search: t.includes('search') || t.includes('fetch') || t.includes('extract'),
    browser: t === 'browser',
    message: t === 'message' || /action":"send/.test(commandText),
    error: Boolean(error) || /error|failed|exception|traceback|command exited with code [1-9]|status":"error|no such file|permission denied|denied|cannot|unable/.test(r),
    mutating: write || destructiveIntent || /restart|send|apply|patch|mv /.test(commandText),
    external: /message|send|telegram|discord|slack|email|webhook|publish|upload/.test(commandText),
    code: /mvn|npm|pnpm|yarn|pytest|gradle|javac|tsc|eslint|git diff|node -|\.java|\.vue|\.ts|\.js|function |class /.test(c),
    config: /openclaw|gateway|config|plugin|cron|daemon|launchagent|contextengine/.test(c),
    data: artifact,
    artifactWrite: write && artifact,
    artifactRead: read && artifact && (/cat\s+(?!>)|stat |wc |read|读回/.test(commandWithoutHereDoc) || /bytes|\/users/.test(r)),
    semanticEvidence: /node -|pytest|npm test|mvn test|assert|ok":true|passed|expected|actual|排序|算法|json\.parse|jq |python3 -/.test(c),
    diffEvidence: /git diff|diff --git|changed lines|修改行|diff/.test(c),
    testEvidence: /npm test|pytest|mvn test|gradle test|vitest|jest|测试|test.*passed|ok":true/.test(c),
    buildEvidence: /npm run build|mvn .*compile|mvn .*install|gradle build|tsc|编译|构建|build.*passed/.test(c),
    oracleEvidence: /oracle|口径|同源|等价|对比|expected|actual|golden|baseline|旧逻辑|导出正确|正确接口|business equivalent|same source/.test(c),
    changedLinesEvidence: /git diff|diff --git|changed lines|修改行|逐行|traceable|追溯|每一处|review changed/.test(c),
    docLocaleIssue: hasDocLocaleIssueFromText(c),
    dangerous,
    dangerousIntent: destructiveIntent,
    safeInspection: inspectionIntent,
    raw: c
  };
}

