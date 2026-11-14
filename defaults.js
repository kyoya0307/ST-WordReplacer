// 迁移自用户提供的 OwO 词库；仅修复缺失引号，保留全部原替换值。
export const DEFAULT_GROUPS = [
  {
    "id": "delete",
    "name": "删除词",
    "enabled": true,
    "rules": [
      {
        "id": "original-0-delete",
        "from": "母狗",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-1-delete",
        "from": "母猪",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-2-delete",
        "from": "母老虎",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-3-delete",
        "from": "并不存在的",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-4-delete",
        "from": "不存在的",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-5-delete",
        "from": "极其",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-6-delete",
        "from": "黄脸婆",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-7-delete",
        "from": "欧巴桑",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-8-delete",
        "from": "娘们",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-9-delete",
        "from": "八婆",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-10-delete",
        "from": "婆娘",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-11-delete",
        "from": "马子",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-12-delete",
        "from": "假小子",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-13-delete",
        "from": "男人婆",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-14-delete",
        "from": "娘炮",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-15-delete",
        "from": "老嫂子",
        "to": "",
        "enabled": true
      },
      {
        "id": "original-16-delete",
        "from": "巾帼不让须眉",
        "to": "",
        "enabled": true
      }
    ]
  },
  {
    "id": "words",
    "name": "整词替换",
    "enabled": true,
    "rules": [
      {
        "id": "original-0-words",
        "from": "老天爷",
        "to": "老天奶",
        "enabled": true
      },
      {
        "id": "original-1-words",
        "from": "父母",
        "to": "双亲",
        "enabled": true
      },
      {
        "id": "original-2-words",
        "from": "嫉妒",
        "to": "忮忌",
        "enabled": true
      },
      {
        "id": "original-3-words",
        "from": "产科",
        "to": "育科",
        "enabled": true
      },
      {
        "id": "original-4-words",
        "from": "子宫",
        "to": "女子胞",
        "enabled": true
      },
      {
        "id": "original-5-words",
        "from": "白嫖",
        "to": "白剽",
        "enabled": true
      },
      {
        "id": "original-6-words",
        "from": "姑娘们",
        "to": "姑娘们",
        "enabled": true
      },
      {
        "id": "original-7-words",
        "from": "害喜",
        "to": "孕吐",
        "enabled": true
      },
      {
        "id": "original-8-words",
        "from": "甲方爸爸",
        "to": "甲方",
        "enabled": true
      },
      {
        "id": "original-9-words",
        "from": "胸大无脑",
        "to": "蠢钝",
        "enabled": true
      },
      {
        "id": "original-10-words",
        "from": "水性杨花",
        "to": "用情不专",
        "enabled": true
      },
      {
        "id": "original-11-words",
        "from": "红杏出墙",
        "to": "感情出轨",
        "enabled": true
      },
      {
        "id": "original-12-words",
        "from": "红颜祸水",
        "to": "乱世佳人",
        "enabled": true
      },
      {
        "id": "original-13-words",
        "from": "旺夫",
        "to": "自在丰盈",
        "enabled": true
      },
      {
        "id": "original-14-words",
        "from": "克夫",
        "to": "坚韧通透",
        "enabled": true
      },
      {
        "id": "original-15-words",
        "from": "旺夫相",
        "to": "锦程相",
        "enabled": true
      },
      {
        "id": "original-16-words",
        "from": "克夫相",
        "to": "清越相",
        "enabled": true
      },
      {
        "id": "original-17-words",
        "from": "命硬克夫",
        "to": "命格自强",
        "enabled": true
      },
      {
        "id": "original-18-words",
        "from": "旺夫命",
        "to": "瑞锦命",
        "enabled": true
      },
      {
        "id": "original-19-words",
        "from": "克夫命",
        "to": "清卓命",
        "enabled": true
      },
      {
        "id": "original-20-words",
        "from": "老子",
        "to": "我",
        "enabled": true
      },
      {
        "id": "original-21-words",
        "from": "老女人",
        "to": "阿姨",
        "enabled": true
      },
      {
        "id": "original-22-words",
        "from": "拜金女",
        "to": "现实的女人",
        "enabled": true
      },
      {
        "id": "original-23-words",
        "from": "不守妇道",
        "to": "思想独立、追求自由",
        "enabled": true
      },
      {
        "id": "original-24-words",
        "from": "三从四德",
        "to": "自尊自爱、自立自强",
        "enabled": true
      },
      {
        "id": "original-25-words",
        "from": "女子无才便是德",
        "to": "腹有诗书气自华，心有乾坤德自厚。",
        "enabled": true
      },
      {
        "id": "original-26-words",
        "from": "女人四十豆腐渣",
        "to": "女人四十，风华正佳",
        "enabled": true
      },
      {
        "id": "original-27-words",
        "from": "处女作",
        "to": "开刃作",
        "enabled": true
      },
      {
        "id": "original-28-words",
        "from": "处女地",
        "to": "未垦土地",
        "enabled": true
      },
      {
        "id": "original-29-words",
        "from": "处女座",
        "to": "室女座",
        "enabled": true
      },
      {
        "id": "original-30-words",
        "from": "处女",
        "to": "无性行为经验者",
        "enabled": true
      },
      {
        "id": "original-31-words",
        "from": "巾帼",
        "to": "峨眉",
        "enabled": true
      },
      {
        "id": "original-32-words",
        "from": "管家婆",
        "to": "当家",
        "enabled": true
      },
      {
        "id": "original-33-words",
        "from": "嫉恨",
        "to": "愱恨",
        "enabled": true
      },
      {
        "id": "original-34-words",
        "from": "外婆",
        "to": "姥姥",
        "enabled": true
      },
      {
        "id": "original-35-words",
        "from": "嫖娼",
        "to": "闝倡",
        "enabled": true
      },
      {
        "id": "original-36-words",
        "from": "婊子",
        "to": "表子",
        "enabled": true
      },
      {
        "id": "original-37-words",
        "from": "姘头",
        "to": "拼头",
        "enabled": true
      },
      {
        "id": "original-38-words",
        "from": "妄想",
        "to": "忹想",
        "enabled": true
      },
      {
        "id": "original-39-words",
        "from": "奴婢",
        "to": "虏仆",
        "enabled": true
      },
      {
        "id": "original-40-words",
        "from": "奴隶",
        "to": "虏隶",
        "enabled": true
      },
      {
        "id": "original-41-words",
        "from": "母凭子贵",
        "to": "母以嗣贵",
        "enabled": true
      },
      {
        "id": "original-42-words",
        "from": "老板娘",
        "to": "老板",
        "enabled": true
      },
      {
        "id": "original-43-words",
        "from": "学长学姐",
        "to": "前辈们",
        "enabled": true
      },
      {
        "id": "original-44-words",
        "from": "妖言",
        "to": "夭言",
        "enabled": true
      },
      {
        "id": "original-45-words",
        "from": "像荡妇一样求欢",
        "to": "如露滴牡丹开",
        "enabled": true
      },
      {
        "id": "original-46-words",
        "from": "妇女之仁",
        "to": "柔仁之弊",
        "enabled": true
      },
      {
        "id": "original-47-words",
        "from": "婆婆妈妈",
        "to": "琐絮不休",
        "enabled": true
      },
      {
        "id": "original-48-words",
        "from": "娘们唧唧",
        "to": "琐絮不休",
        "enabled": true
      },
      {
        "id": "original-49-words",
        "from": "大龄剩女",
        "to": "单身女性",
        "enabled": true
      },
      {
        "id": "original-50-words",
        "from": "剩女",
        "to": "单身女性",
        "enabled": true
      },
      {
        "id": "original-51-words",
        "from": "破鞋",
        "to": "有感情经历的女性",
        "enabled": true
      },
      {
        "id": "original-52-words",
        "from": "泼妇",
        "to": "性格强势的女性",
        "enabled": true
      },
      {
        "id": "original-53-words",
        "from": "悍妇",
        "to": "性格爽率的女性",
        "enabled": true
      },
      {
        "id": "original-54-words",
        "from": "最毒妇人心",
        "to": "心肠歹毒",
        "enabled": true
      },
      {
        "id": "original-55-words",
        "from": "头发长，见识短",
        "to": "见识短浅",
        "enabled": true
      },
      {
        "id": "original-56-words",
        "from": "大妈",
        "to": "阿姨",
        "enabled": true
      },
      {
        "id": "original-57-words",
        "from": "视奸",
        "to": "视监",
        "enabled": true
      },
      {
        "id": "original-58-words",
        "from": "傻逼",
        "to": "傻宝",
        "enabled": true
      },
      {
        "id": "original-59-words",
        "from": "谄媚",
        "to": "谄魅",
        "enabled": true
      },
      {
        "id": "original-60-words",
        "from": "装逼",
        "to": "表现自己",
        "enabled": true
      },
      {
        "id": "original-61-words",
        "from": "撕逼",
        "to": "争执",
        "enabled": true
      },
      {
        "id": "original-62-words",
        "from": "圣母",
        "to": "心软的人",
        "enabled": true
      },
      {
        "id": "original-63-words",
        "from": "绿茶婊",
        "to": "君子兰",
        "enabled": true
      },
      {
        "id": "original-64-words",
        "from": "崇洋媚外",
        "to": "崇洋魅外",
        "enabled": true
      },
      {
        "id": "original-65-words",
        "from": "侮辱",
        "to": "污辱",
        "enabled": true
      },
      {
        "id": "original-66-words",
        "from": "毒药",
        "to": "螙药",
        "enabled": true
      },
      {
        "id": "original-67-words",
        "from": "妨碍",
        "to": "防碍",
        "enabled": true
      },
      {
        "id": "original-68-words",
        "from": "女神节",
        "to": "妇女节",
        "enabled": true
      },
      {
        "id": "original-69-words",
        "from": "小孕妇",
        "to": "孕妇",
        "enabled": true
      },
      {
        "id": "original-70-words",
        "from": "妇科",
        "to": "女科",
        "enabled": true
      },
      {
        "id": "original-71-words",
        "from": "恶露",
        "to": "产经",
        "enabled": true
      },
      {
        "id": "original-72-words",
        "from": "英雄",
        "to": "英杰",
        "enabled": true
      },
      {
        "id": "original-73-words",
        "from": "父辈",
        "to": "亲辈",
        "enabled": true
      },
      {
        "id": "original-74-words",
        "from": "师父",
        "to": "师傅",
        "enabled": true
      },
      {
        "id": "original-75-words",
        "from": "徒弟",
        "to": "徒子",
        "enabled": true
      },
      {
        "id": "original-76-words",
        "from": "战袍",
        "to": "衣服",
        "enabled": true
      },
      {
        "id": "original-77-words",
        "from": "来姨妈",
        "to": "来月经",
        "enabled": true
      },
      {
        "id": "original-78-words",
        "from": "姨妈巾",
        "to": "卫生巾",
        "enabled": true
      },
      {
        "id": "original-79-words",
        "from": "妖媚",
        "to": "娇媚",
        "enabled": true
      },
      {
        "id": "original-80-words",
        "from": "妖孽",
        "to": "灾孽",
        "enabled": true
      },
      {
        "id": "original-81-words",
        "from": "小三",
        "to": "第三者",
        "enabled": true
      },
      {
        "id": "original-82-words",
        "from": "男小三",
        "to": "男小三",
        "enabled": true
      },
      {
        "id": "original-83-words",
        "from": "小三花",
        "to": "小三花",
        "enabled": true
      },
      {
        "id": "original-84-words",
        "from": "心机女",
        "to": "城府深的人",
        "enabled": true
      },
      {
        "id": "original-85-words",
        "from": "弱女子",
        "to": "体弱的人",
        "enabled": true
      },
      {
        "id": "original-86-words",
        "from": "女汉子",
        "to": "坚韧果敢的女性",
        "enabled": true
      },
      {
        "id": "original-87-words",
        "from": "女强人",
        "to": "事业有成的女性",
        "enabled": true
      },
      {
        "id": "original-88-words",
        "from": "素颜",
        "to": "本颜",
        "enabled": true
      },
      {
        "id": "original-89-words",
        "from": "姨妈期",
        "to": "生理期",
        "enabled": true
      }
    ]
  },
  {
    "id": "characters",
    "name": "单字替换（注意误替换）",
    "enabled": true,
    "rules": [
      {
        "id": "original-0-characters",
        "from": "媮",
        "to": "偷",
        "enabled": true
      },
      {
        "id": "original-1-characters",
        "from": "媸",
        "to": "丑",
        "enabled": true
      },
      {
        "id": "original-2-characters",
        "from": "娸",
        "to": "丑",
        "enabled": true
      },
      {
        "id": "original-3-characters",
        "from": "姦",
        "to": "歼",
        "enabled": true
      },
      {
        "id": "original-4-characters",
        "from": "媿",
        "to": "愧",
        "enabled": true
      },
      {
        "id": "original-5-characters",
        "from": "奴",
        "to": "虏",
        "enabled": true
      },
      {
        "id": "original-6-characters",
        "from": "毒",
        "to": "螙",
        "enabled": true
      },
      {
        "id": "original-7-characters",
        "from": "侄",
        "to": "姪",
        "enabled": true
      },
      {
        "id": "original-8-characters",
        "from": "娼",
        "to": "倡",
        "enabled": true
      },
      {
        "id": "original-9-characters",
        "from": "嫌",
        "to": "慊",
        "enabled": true
      },
      {
        "id": "original-10-characters",
        "from": "霉",
        "to": "楣",
        "enabled": true
      },
      {
        "id": "original-11-characters",
        "from": "嫉",
        "to": "忌",
        "enabled": true
      },
      {
        "id": "original-12-characters",
        "from": "奸",
        "to": "歼",
        "enabled": true
      },
      {
        "id": "original-13-characters",
        "from": "妨",
        "to": "㤃",
        "enabled": true
      },
      {
        "id": "original-14-characters",
        "from": "婪",
        "to": "惏",
        "enabled": true
      },
      {
        "id": "original-15-characters",
        "from": "妒",
        "to": "忮",
        "enabled": true
      },
      {
        "id": "original-16-characters",
        "from": "妓",
        "to": "伎",
        "enabled": true
      }
    ]
  },
  {
    "id": "custom",
    "name": "我的自定义词库",
    "enabled": true,
    "rules": []
  }
];
