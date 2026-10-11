import type { LegalDocumentDefinition } from '../legal-bundle';

export const privacyZhCn: LegalDocumentDefinition = {
  kind: 'privacy',
  title: 'TaskPilot 隐私政策',
  version: 'privacy-2026-09-01',
  effectiveDate: '2026-09-01',
  sections: [
    { title: '1. 范围与角色', paragraphs: ['本政策说明当前 TaskPilot 开发版本为完成 GitHub 登录、账号建立和会话安全所处理的信息。第三方自行部署时，该部署运营者决定处理目的和方式，并应提供适用于其部署的隐私政策。'] },
    { title: '2. GitHub 身份信息', paragraphs: ['系统处理 GitHub 的持久数字标识、建议显示名称，以及在你选择时使用的公开头像。当前授权不申请邮箱范围；GitHub OAuth 令牌仅用于获取身份并在完成后丢弃。'] },
    { title: '3. TaskPilot 账号与同意记录', paragraphs: ['系统建立内部 UserId 与 ExternalIdentity 关联，并保存本次协议组合、用户协议、隐私政策、语言和接受时间，用于证明首次注册时接受了哪一组法律文档。'] },
    { title: '4. 会话与安全数据', paragraphs: ['服务端在 Redis 中保存有时限的登录尝试、限流计数和会话技术状态；PostgreSQL 保存账号、外部身份关联和协议接受记录；Desktop 将 refresh 凭据和未完成登录的恢复材料保存在操作系统凭据存储中。来源网络和安装标识用于登录限流与防滥用。'] },
    { title: '5. 使用、共享与保留', paragraphs: ['上述信息用于身份验证、账号和会话安全、故障恢复与防滥用。当前实现未包含营销分析。信息仅按提供服务、安全防护或法律义务所需保留；开源部署者应结合其运行环境明确具体保留和删除安排。'] },
    { title: '6. 你的选择与权利', paragraphs: ['你可以不继续注册，也可以不采用 GitHub 头像。访问、更正、删除或撤回相关请求应由实际部署运营者依据适用法律处理；某些安全和法定义务记录可能需要继续保留。'] },
    { title: '7. 安全、跨境与联系', paragraphs: ['TaskPilot 采用最小授权、loopback proof 和操作系统凭据存储等措施，但任何系统都无法保证绝对安全。正式对外运营前，实际运营者必须公开身份、联系渠道、数据存放或跨境安排及法定权利请求方式。'] },
  ],
};
