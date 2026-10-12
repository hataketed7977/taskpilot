import type { LegalDocumentDefinition } from '../legal-bundle';

export const privacyEn: LegalDocumentDefinition = {
  kind: 'privacy',
  title: 'TaskPilot Privacy Policy',
  version: 'privacy-2026-09-01',
  effectiveDate: '2026-09-01',
  sections: [
    { title: '1. Scope and roles', paragraphs: ['This policy explains the information processed by the current TaskPilot development version for GitHub sign-in, account creation, and session security. For a third-party deployment, that deployment operator determines the purposes and means of processing and should provide a privacy policy appropriate to its deployment.'] },
    { title: '2. GitHub identity information', paragraphs: ['The system processes your persistent numeric GitHub identifier, suggested display name, and, if you choose, your public avatar. The current authorization does not request email access. The GitHub OAuth token is used only to retrieve identity information and is discarded afterward.'] },
    { title: '3. TaskPilot account and consent record', paragraphs: ['The system links an internal UserId to an ExternalIdentity and records the accepted legal bundle, terms, privacy policy, language, and acceptance time to establish which legal documents you accepted during first-time registration.'] },
    { title: '4. Session and security data', paragraphs: ['The server stores time-limited login attempts, rate-limit counters, and session technical state in Redis. PostgreSQL stores accounts, external identity links, and legal acceptance records. Desktop stores refresh credentials and unfinished sign-in recovery material in the operating system credential store. Source network and installation identifiers support login rate limiting and abuse prevention.'] },
    { title: '5. Use, sharing, and retention', paragraphs: ['This information is used for authentication, account and session security, recovery, and abuse prevention. The current implementation does not include marketing analytics. Information is retained only as needed to provide the service, protect security, or meet legal obligations. Open-source deployment operators should define concrete retention and deletion arrangements for their environments.'] },
    { title: '6. Your choices and rights', paragraphs: ['You may choose not to register and may decline to use your GitHub avatar. Requests to access, correct, delete, or withdraw consent should be handled by the actual deployment operator under applicable law. Some security or legally required records may need to be retained.'] },
    { title: '7. Security, international transfers, and contact', paragraphs: ['TaskPilot uses measures such as least-privilege authorization, loopback proof, and operating system credential storage, but no system can guarantee absolute security. Before public operation, the actual operator must publish its identity, contact channel, data location or international transfer arrangements, and the method for exercising legal rights.'] },
  ],
};
