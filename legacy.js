// 上下文规则来源：OwO。默认顺序和匹配条件沿用原规则；不执行导入的代码。
export const DEFAULT_NOUNS = '东西 家 房 车 钱 包 事 朋友 同学 老师 手机 衣服 鞋 书 笔 饭 菜 照片 工作 单位 公司 病 生日 名字 项链 戒指 眼镜 钥匙 电脑 猫 狗 手艺'.split(' ');
export const DEFAULT_VERBS = '是想看听找回像接送陪帮爱疼恨打问求叫认给跟同带摸抱亲夸骂碰拿买偷抢去';
export const CONTEXT_MATCH_TEXT = {
    combination:'一个或多个贬义修饰字，后接“娘们、三八、八婆、婆娘、马子”之一，中间可有空白。',
    direction:'“去” + 代词 + “妈的/娘的”，或“去” + 代词 + “妈/娘”。代词包括你、他、她、它、牠、祂和 ta。',
    exclamation:'“操/我操”与亲属称谓组成的表达；或两侧没有汉字的独立“操/我操”。',
    kinship:'代词 + “妈的/娘的”，同时检查前面的动作字和后面的名词。',
    prefix:'主语、副词或指示词 + 可选代词 + “妈/娘”及可选“的”；也处理“全是/都是/就是/总是”后的对应表达。',
    isolated:'独立的“妈的/娘的”；只有两侧都没有汉字时才处理。',
    number:'“三八”二字；数字相邻表达以及已列出的节日、固定名称除外。',
};
export const CONTEXT_RULES = [
{"id":"combination","name":"组合词优先处理","stage":"before","description":"先识别修饰词与称呼组成的完整组合，避免普通词库先替换一部分。","action":"删除匹配到的整个组合。","protection":"完整组合优先于词库；不等于识别所有语境。","sample":"姑娘们正在读书。", steps: [
    [/[丑臭傻蠢烂恶疯泼贱肥破脏坏龟老死]+\s*(娘们|三八|八婆|婆娘|马子)/giu, ''],
]},
{"id":"direction","name":"带“去”的句式","stage":"after","description":"识别带“去”的特定句式，保留代词和必要的连接字。","action":"保留“去”和代词；原句带“的”时保留“的”。","protection":"后接受保护名词或亲属用字时跳过相应匹配。","sample":"去他妈的家", steps: [
    [/去(你|他|她|它|牠|祂|[tT][aA])(妈的|娘的)(?!(?:东西|家|房|车|钱|包|事|朋友|同学|老师|手机|衣服|鞋|书|笔|饭|菜|照片|工作|单位|公司|病|生日|名字|项链|戒指|眼镜|钥匙|电脑|猫|狗|手艺))/g, '去$1的'],
    [/去(你|他|她|它|牠|祂|[tT][aA])(妈|娘)(?!的|\s*[妈咪亲祖舅家那这])/g, '去$1'],
]},
{"id":"exclamation","name":"感叹与组合表达","stage":"after","description":"处理特定组合，以及两侧没有汉字的独立感叹词。","action":"默认替换为“劁”；匹配包含“我”时保留“我”。","protection":"独立词的两侧不能是汉字，避免影响“操作”等普通词语。","sample":"操作说明和早操安排", steps: [
    [/(我?操)\s*(?:你|他|她|它|牠|祂|[tT][aA])?(?:妈|娘)的?/g, match => match.startsWith('我') ? '我劁' : '劁'],
    [/(?<![\u4e00-\u9fa5])我操(?![\u4e00-\u9fa5])/gu, '我劁'],
    [/(?<![\u4e00-\u9fa5])操(?![\u4e00-\u9fa5])/gu, '劁'],
]},
{"id":"kinship","name":"亲属语境判断","stage":"after","description":"用前面的动作字和后面的名词区分亲属叙述与语气表达。","action":"删除通过前后保护检查的匹配片段。","protection":"前有动作保护字或后有名词保护项时不处理；保护表可在下方编辑。","sample":"这是他妈的家", steps: [
    [/(?<![是想看听找回像接送陪帮爱疼恨打问求叫认给跟同带摸抱亲夸骂碰拿买偷抢去])(你|他|她|它|牠|祂|[tT][aA])(妈的|娘的)(?!(?:东西|家|房|车|钱|包|事|朋友|同学|老师|手机|衣服|鞋|书|笔|饭|菜|照片|工作|单位|公司|病|生日|名字|项链|戒指|眼镜|钥匙|电脑|猫|狗|手艺))/g, ''],
]},
{"id":"prefix","name":"主语与语气前缀","stage":"after","description":"识别主语、副词、指示词及“都是”等前缀后的特定表达。","action":"保留主语或前缀，“都是”等结构保留“是”。","protection":"后接亲属相关字时跳过；与亲属语境判断是独立规则。","sample":"你娘真好", steps: [
    [/(谁|大家|你|我|他|她|它|你们|我们|他们)(他|她|它|牠|祂|你|我|[tT][aA])(妈|娘)的?(?!\s*[妈咪亲祖舅家])/g, '$1'],
    [/(真|太|最|简直|特么|还|又|竟|竟然|老子|别)(?:他|她|它|牠|祂|你|我|[tT][aA])?(妈|娘)的?(?!\s*[妈咪亲祖舅家])/g, '$1'],
    [/(这|那|都|就|全)(他|她|它|牠|祂|你|我|[tT][aA])(妈|娘)的?(?!\s*[妈咪亲祖舅家])/g, '$1'],
    [/(全|都|就|总)是(他|她|它|牠|祂|你|我|[tT][aA])(妈|娘)的?(?!\s*[妈咪亲祖舅家])/g, '$1是'],
]},
{"id":"isolated","name":"独立语气片段","stage":"after","description":"只处理两侧都没有汉字的特定语气片段。","action":"删除整个匹配片段。","protection":"夹在普通汉字中时不按独立语气处理。","sample":"妈妈的书放在桌上", steps: [
    [/(?<![\u4e00-\u9fa5])(妈的|娘的)(?![\u4e00-\u9fa5])/g, ''],
]},
{"id":"number","name":"数字与固定名称判断","stage":"after","description":"处理特定双字称呼，同时识别数字、节日和固定名称。","action":"删除通过保护检查的匹配片段。","protection":"保留数字相邻表达、三八妇女节、三八线等固定名称。","sample":"三八妇女节 三八线 一三八", steps: [
    [/(?<![零一二两三四五六七八九十百千万亿0-9])三八(?!妇女节|节|线|红|大盖|[零一二两三四五六七八九十百千万亿0-9])/g, ''],
]},
];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function createContextOptions() {
    return {rules:Object.fromEntries(CONTEXT_RULES.map(r=>[r.id,{enabled:true,replacement:null}])),nouns:[...DEFAULT_NOUNS],verbs:DEFAULT_VERBS};
}
export function validateContextOptions(data) {
    const out=createContextOptions();
    if(data===undefined)return out;
    if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('特殊句式配置格式不正确。');
    if(data.rules!==undefined&&(!data.rules||typeof data.rules!=='object'||Array.isArray(data.rules)))throw new Error('特殊句式开关格式不正确。');
    for(const rule of CONTEXT_RULES){
        const config=data.rules?.[rule.id];if(config===undefined)continue;
        if(!config||typeof config!=='object'||Array.isArray(config))throw new Error('特殊句式配置格式不正确。');
        if(config.enabled!==undefined&&typeof config.enabled!=='boolean')throw new Error('特殊句式开关必须为布尔值。');
        if(config.replacement!==undefined&&config.replacement!==null&&(typeof config.replacement!=='string'||config.replacement.length>10000))throw new Error('特殊句式替换文字过长或格式错误。');
        out.rules[rule.id]={enabled:config.enabled!==false,replacement:config.replacement??null};
    }
    if(data.nouns!==undefined){
        if(!Array.isArray(data.nouns)||data.nouns.length>500||data.nouns.some(s=>typeof s!=='string'||!s||s.length>100))throw new Error('名词保护表最多 500 项，每项 1–100 字。');
        out.nouns=[...new Set(data.nouns)];
    }
    if(data.verbs!==undefined){
        if(typeof data.verbs!=='string'||data.verbs.length>500)throw new Error('动作保护字应为不超过 500 字的文字。');
        out.verbs=[...new Set(data.verbs)].join('');
    }
    return out;
}
export function compileContext(options) {
    const config=validateContextOptions(options);
    const entries=CONTEXT_RULES.map(rule=>({...rule,config:config.rules[rule.id],steps:rule.steps.map(([pattern,replacement])=>{
        let source=pattern.source;
        // 普通文本转义后再加入固定模板，配置不接受正则或代码。
        if(rule.id==='direction'||rule.id==='kinship')source=source.replace(DEFAULT_NOUNS.join('|'),()=>config.nouns.length?config.nouns.map(escape).join('|'):'(?!)');
        if(rule.id==='kinship')source=source.replace(`(?<![${DEFAULT_VERBS}])`,()=>config.verbs?`(?<!(?:${[...config.verbs].map(escape).join('|')}))`:'');
        return [new RegExp(source,pattern.flags),replacement];
    })}));
    return {
        run(text,stage,onHit=()=>{},onlyId=null){
            for(const rule of entries){
                if(rule.stage!==stage||!rule.config.enabled||(onlyId&&rule.id!==onlyId))continue;
                for(const [pattern,replacement] of rule.steps){
                    pattern.lastIndex=0;
                    text=text.replace(pattern,(...args)=>{
                        const from=args[0];
                        const to=rule.config.replacement??(typeof replacement==='function'?replacement(from):replacement.replace(/\$(\d+)/g,(_,i)=>args[Number(i)]??''));
                        if(to!==from)onHit(from,to,rule.name);
                        return to;
                    });
                }
            }
            return text;
        },
    };
}
export const legacyBefore = text => compileContext().run(text,'before');
export const legacyAfter = text => compileContext().run(text,'after');
