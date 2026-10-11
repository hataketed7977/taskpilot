import type { LegalDocumentDefinition } from '../legal-bundle';

export const termsZhCn: LegalDocumentDefinition = {
  kind: 'terms',
  title: 'TaskPilot 用户协议',
  version: 'terms-2026-09-01',
  effectiveDate: '2026-09-01',
  sections: [
    { title: '1. 适用与接受', paragraphs: ['本协议适用于你使用 TaskPilot 软件及由实际部署运营者提供的相关服务。完成首次注册即表示你已阅读并同意本协议；不同意时请勿继续注册。'] },
    { title: '2. 服务说明', paragraphs: ['TaskPilot 是开源、持续演进的工作协作与 Agent 辅助工具。预览或开发版本可能不稳定，不应直接用于依赖高可用、自动决策或不可逆操作的生产场景。'] },
    { title: '3. GitHub 账号', paragraphs: ['你通过 GitHub 完成身份验证，并应妥善保护 GitHub 账号和本机凭据。GitHub 的服务条款及可用性由 GitHub 负责。'] },
    { title: '4. 用户内容与授权', paragraphs: ['你保留对合法上传内容的权利，并仅为提供、维护和保护服务之目的，授权实际部署运营者处理这些内容。你应确保自己有权提交和处理相关数据。'] },
    { title: '5. Agent 与 AI 输出', paragraphs: ['Agent 与 AI 输出可能不准确、不完整或不适合你的场景。你应在执行代码、发布内容、访问数据或采取其他有影响的行动前进行人工复核，并对最终决定负责。'] },
    { title: '6. 禁止行为', paragraphs: ['不得利用服务侵害他人权益、绕过安全控制、传播恶意代码、未经授权访问系统，或从事违反适用法律的活动。'] },
    { title: '7. 第三方服务与开源许可', paragraphs: ['第三方服务受其各自条款约束。TaskPilot 源代码的使用受仓库 LICENSE 约束；开源许可不等同于任何托管服务承诺，也不替代本协议。'] },
    { title: '8. 中断、终止与责任', paragraphs: ['为安全、维护或法律原因，服务可能被限制或中断。在适用法律允许的范围内，软件按现状提供；本条不排除法律规定不得限制的消费者权利或责任。'] },
    { title: '9. 更新与联系', paragraphs: ['协议发生重要变化时，应在再次接受前向你展示新的协议组合。正式对外运营前，实际运营者必须补充并公开其法定名称、联系渠道和适用争议处理信息；第三方自行部署时，由该部署运营者提供自己的条款并承担相应责任。'] },
  ],
};
