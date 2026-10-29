export const detailMessages = {
  en: {
  loading: "Loading…",
  loadError: "Unable to load this work item. Try again.",
  titleLabel: "Title",
  descriptionLabel: "Description",
  createdAtLabel: "Created",
  updatedAtLabel: "Updated",
  emptyDescription: "No description",
  editTitle: "Edit title",
  editDescription: "Edit description",
  saving: "Saving…",
  saved: "Saved",
  validation: {
    titleRequired: "Title is required.",
    titleTooLong: "Title must be 300 characters or fewer.",
    descriptionTooLong:
      "Description must be 10,000 characters or fewer.",
  },
  saveError: {
    title:
      "Title could not be saved temporarily. Your draft is preserved.",
    description:
      "Description could not be saved temporarily. Your draft is preserved.",
  },
  conflict: {
    title: { title: "Title conflict" },
    description: { title: "Description conflict" },
    latest: "Latest value: {{value}}",
    draft: "Local draft: {{value}}",
    retry: "Retry with latest version",
    useLatest: "Use latest content",
  },
},
  "zh-CN": {
  loading: "正在加载…",
  loadError: "暂时无法加载，请重试。",
  titleLabel: "标题",
  descriptionLabel: "描述",
  createdAtLabel: "创建时间",
  updatedAtLabel: "更新时间",
  emptyDescription: "暂无描述",
  editTitle: "编辑标题",
  editDescription: "编辑描述",
  saving: "保存中…",
  saved: "已保存",
  validation: {
    titleRequired: "标题不能为空。",
    titleTooLong: "标题最多 300 个字符。",
    descriptionTooLong: "描述最多 10000 个字符。",
  },
  saveError: {
    title: "暂时无法保存标题，草稿已保留。",
    description: "暂时无法保存描述，草稿已保留。",
  },
  conflict: {
    title: { title: "标题发生冲突" },
    description: { title: "描述发生冲突" },
    latest: "最新值：{{value}}",
    draft: "本地草稿：{{value}}",
    retry: "基于最新版本重试",
    useLatest: "使用最新内容",
  },
},
} as const;
