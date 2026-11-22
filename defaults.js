// 用途：中性示例词与测试数据。
// 中性测试词库：仅用于验证迁移、复制和冲突逻辑，不包含真实用户规则。
export const DEFAULT_GROUPS = [
  {
    "id": "delete",
    "name": "删除词",
    "enabled": true,
    "rules": [
      {
        "id": "sample-delete-1",
        "from": "测试删词",
        "to": "",
        "enabled": true
      },
      {
        "id": "sample-delete-2",
        "from": "示例占位",
        "to": "",
        "enabled": true
      },
      {
        "id": "sample-delete-3",
        "from": "草稿标记",
        "to": "",
        "enabled": true
      }
    ]
  },
  {
    "id": "replace",
    "name": "整词替换",
    "enabled": true,
    "rules": [
      {
        "id": "sample-replace-1",
        "from": "旧称呼",
        "to": "新称呼",
        "enabled": true
      },
      {
        "id": "sample-replace-2",
        "from": "测试旧词",
        "to": "测试新词",
        "enabled": true
      }
    ]
  },
  {
    "id": "single",
    "name": "单字替换（注意误替换）",
    "enabled": true,
    "rules": [
      {
        "id": "sample-single-1",
        "from": "㐀",
        "to": "㐁",
        "enabled": true
      },
      {
        "id": "sample-single-2",
        "from": "㐂",
        "to": "㐃",
        "enabled": true
      }
    ]
  },
  {
    "id": "custom",
    "name": "我的自定义词库",
    "enabled": false,
    "rules": []
  }
];
