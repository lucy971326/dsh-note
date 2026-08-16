/** Dictionaries for the Session Notes dock. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  title: '会话笔记',
  count: '条',
  loading: '正在加载笔记…',
  empty: '当前会话还没有笔记。',
  expand: '展开笔记',
  collapse: '收起笔记',
  add: '新增笔记',
  edit: '编辑',
  delete: '删除',
  key: 'Key',
  content: '内容',
  storedAt: '存储时间',
  save: '保存',
  cancel: '取消',
  error: '笔记操作失败，请重试。',
  required: 'Key 和内容不能为空。',
} as const

/** The locale key union. */
export type SessionNotesKey = keyof typeof zh

/** English dictionary, checked complete against the Chinese key set. */
export const en = {
  title: 'Session notes',
  count: 'notes',
  loading: 'Loading notes…',
  empty: 'This session has no notes yet.',
  expand: 'Expand notes',
  collapse: 'Collapse notes',
  add: 'Add note',
  edit: 'Edit',
  delete: 'Delete',
  key: 'Key',
  content: 'Content',
  storedAt: 'Stored at',
  save: 'Save',
  cancel: 'Cancel',
  error: 'The note operation failed. Try again.',
  required: 'Key and content are required.',
} satisfies Record<SessionNotesKey, string>
