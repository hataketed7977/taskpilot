import type { LegalDocumentDefinition } from '../legal-bundle';

export const termsEn: LegalDocumentDefinition = {
  kind: 'terms',
  title: 'TaskPilot Terms of Service',
  version: 'terms-2026-09-01',
  effectiveDate: '2026-09-01',
  sections: [
    { title: '1. Scope and acceptance', paragraphs: ['These terms apply to your use of the TaskPilot software and related services provided by the operator of your deployment. By completing first-time registration, you confirm that you have read and accepted these terms. Do not continue if you do not agree.'] },
    { title: '2. Service description', paragraphs: ['TaskPilot is an open-source, evolving work collaboration and Agent-assisted tool. Preview or development versions may be unstable and should not be used directly in production scenarios that depend on high availability, automated decisions, or irreversible actions.'] },
    { title: '3. GitHub account', paragraphs: ['You authenticate through GitHub and are responsible for protecting your GitHub account and local credentials. GitHub is responsible for its own terms and service availability.'] },
    { title: '4. User content and permission', paragraphs: ['You retain your rights in content you lawfully submit. You permit the operator of your deployment to process that content only as needed to provide, maintain, and protect the service. You must have the right to submit and process the relevant data.'] },
    { title: '5. Agent and AI output', paragraphs: ['Agent and AI output may be inaccurate, incomplete, or unsuitable for your situation. You must review it before running code, publishing content, accessing data, or taking another consequential action, and you remain responsible for the final decision.'] },
    { title: '6. Prohibited conduct', paragraphs: ['You must not use the service to infringe the rights of others, bypass security controls, distribute malicious code, access systems without authorization, or violate applicable law.'] },
    { title: '7. Third-party services and open-source license', paragraphs: ['Third-party services are governed by their own terms. Use of the TaskPilot source code is governed by the repository LICENSE. An open-source license is not a commitment to provide a hosted service and does not replace these terms.'] },
    { title: '8. Interruption, termination, and liability', paragraphs: ['The service may be restricted or interrupted for security, maintenance, or legal reasons. To the extent permitted by applicable law, the software is provided as is. Nothing in this section excludes consumer rights or liability that cannot legally be limited.'] },
    { title: '9. Updates and contact', paragraphs: ['If these terms change materially, you should be shown a new legal bundle before accepting again. Before public operation, the actual operator must publish its legal name, contact channel, and applicable dispute information. A third-party operator must provide its own terms and assumes the corresponding responsibility.'] },
  ],
};
