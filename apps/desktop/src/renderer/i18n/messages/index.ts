import { accountMessages } from './account';
import { authMessages } from './auth';
import { boardMessages } from './board';
import { commonMessages } from './common';
import { detailMessages } from './detail';
import { languageMessages } from './language';
import { registrationMessages } from './legal';
import { projectMessages } from './project';
import { sessionMessages } from './session';

export const messageResources = {
  en: {
    translation: {
      language: languageMessages.en,
      common: commonMessages.en,
      session: sessionMessages.en,
      auth: authMessages.en,
      registration: registrationMessages.en,
      project: projectMessages.en,
      board: { ...boardMessages.en, workItemDetail: detailMessages.en },
      account: accountMessages.en,
    },
  },
  'zh-CN': {
    translation: {
      language: languageMessages['zh-CN'],
      common: commonMessages['zh-CN'],
      session: sessionMessages['zh-CN'],
      auth: authMessages['zh-CN'],
      registration: registrationMessages['zh-CN'],
      project: projectMessages['zh-CN'],
      board: { ...boardMessages['zh-CN'], workItemDetail: detailMessages['zh-CN'] },
      account: accountMessages['zh-CN'],
    },
  },
} as const;
