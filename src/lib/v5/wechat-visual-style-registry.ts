import type { ContentDraftArtifact } from "./free-production-contracts";
import type { WechatVisualAnchor, WechatVisualStyleRoute } from "./wechat-visual-contracts";

interface ProductionVisualStyle {
  styleId: string;
  styleName: string;
  bestFor: string[];
  visualAnchor: string;
}

export const WECHAT_VISUAL_PRODUCTION_STYLES: ProductionVisualStyle[] = [
  { styleId: "miniature_map_life_scene", styleName: "微缩地图风", bestFor: ["路径", "旅程", "迁移"], visualAnchor: "浅色路线地图、微缩人物、清晰节点、克制景深" },
  { styleId: "miniature_checklist_scene", styleName: "微缩清单风", bestFor: ["清单", "步骤", "执行"], visualAnchor: "巨大检查表、微缩人物执行动作、完成与风险状态分区" },
  { styleId: "editorial_object_annotation_card", styleName: "具象标注风", bestFor: ["机制", "原则", "验证"], visualAnchor: "暖白留白、真实主体物、少量观察式标注和虚线箭头" },
  { styleId: "editorial_narrative_system_board", styleName: "编辑叙事系统板风", bestFor: ["复杂业务", "多角色", "系统总览"], visualAnchor: "商业编辑插画、中央组织面板、周边信息卡与角色协作" },
  { styleId: "crowd_typography_scene", styleName: "人群造字风", bestFor: ["趋势", "行业", "群体"], visualAnchor: "俯视人群与抽象秩序、强识别轮廓、克制社会议题感" },
  { styleId: "quirky_doodle_character_flow", styleName: "怪诞小人风", bestFor: ["工作流", "自动化", "卡点"], visualAnchor: "纯白背景、冷幽默系统操作员、动作承担核心隐喻" },
  { styleId: "minimal_line_art", styleName: "线条艺术风", bestFor: ["关系", "体验", "个人感受"], visualAnchor: "极简连续线条、大片留白、安静但明确的概念隐喻" },
  { styleId: "monochrome_system_editorial", styleName: "黑白系统风", bestFor: ["SOP", "系统", "标准化"], visualAnchor: "黑白高对比、系统模块、粗细有序的编辑排版感" },
  { styleId: "isometric_timeline_miniature", styleName: "时间微缩风", bestFor: ["演化", "阶段", "迭代"], visualAnchor: "统一轴测时间路径、阶段节点与微缩角色" },
  { styleId: "translucent_object_editorial", styleName: "透明物件风", bestFor: ["产品", "品牌", "工具"], visualAnchor: "半透明产品隐喻、轻科技材质、干净品牌留白" },
  { styleId: "pastel_learning_pyramid", styleName: "粉彩金字塔风", bestFor: ["分层", "能力", "进阶"], visualAnchor: "低饱和分层结构、清晰层级与成长方向" },
  { styleId: "handdrawn_knowledge_card", styleName: "手绘知识风", bestFor: ["流程", "对比", "闭环"], visualAnchor: "暖白纸感、黑灰细线、低饱和模块和自然手绘箭头" }
];

const styleById = new Map(WECHAT_VISUAL_PRODUCTION_STYLES.map((style) => [style.styleId, style]));

function style(styleId: string) {
  const selected = styleById.get(styleId);
  if (!selected) throw new Error(`未注册公众号视觉风格：${styleId}`);
  return selected;
}

function articleText(artifact: ContentDraftArtifact) {
  return `${artifact.selectedTitle} ${artifact.summary} ${artifact.sections.map((section) => `${section.heading} ${section.markdown}`).join(" ")}`;
}

export function recommendWechatVisualRoutes(artifact: ContentDraftArtifact): WechatVisualStyleRoute[] {
  const text = articleText(artifact);
  const brandStyleId = /产品|品牌|工具|功能|发布|JOTO|WorkBuddy|ADP/i.test(text)
    ? "translucent_object_editorial"
    : "monochrome_system_editorial";
  const systemStyleId = /演化|迭代|阶段|过去|现在|未来/.test(text)
    ? "isometric_timeline_miniature"
    : /清单|步骤|落地|检查|执行|上线/.test(text)
      ? "miniature_checklist_scene"
      : /多角色|协同|复杂业务|上下游|系统/.test(text)
        ? "editorial_narrative_system_board"
        : "handdrawn_knowledge_card";
  const hookStyleId = /趋势|行业|市场|群体|变化/.test(text)
    ? "crowd_typography_scene"
    : /焦虑|压力|体验|感受|关系/.test(text)
      ? "minimal_line_art"
      : "quirky_doodle_character_flow";

  const definitions: Array<Omit<WechatVisualStyleRoute, "styleId" | "styleName"> & { styleId: string }> = [
    { routeKey: "brand", routeName: "品牌稳妥型", styleId: brandStyleId, recommendation: "适合官方发布，优先保证专业感与品牌稳定性。", visualIntent: "让读者先建立可信、克制的产品印象" },
    { routeKey: "system", routeName: "系统解释型", styleId: systemStyleId, recommendation: "把文章最重要的机制或工作流变成可理解的视觉结构。", visualIntent: "让读者一眼理解文章的核心结构" },
    { routeKey: "hook", routeName: "传播张力型", styleId: hookStyleId, recommendation: "用动作或隐喻制造记忆点，但不牺牲事实准确性。", visualIntent: "让封面在信息流中更容易被注意" }
  ];

  return definitions.map((item) => {
    const selected = style(item.styleId);
    return { ...item, styleName: selected.styleName };
  });
}

function compact(value: string, maximum = 180) {
  return value.replace(/[#>*_`\[\]()]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function inferVisualType(value: string): WechatVisualAnchor["visualType"] {
  if (/对比|过去|现在|传统|新旧|之前|之后/.test(value)) return "comparison";
  if (/流程|步骤|输入|输出|闭环|自动化/.test(value)) return "workflow";
  if (/路径|阶段|路线|落地/.test(value)) return "path";
  if (/系统|机制|模块|协同/.test(value)) return "system";
  return "metaphor";
}

export function deriveWechatVisualAnchors(artifact: ContentDraftArtifact): WechatVisualAnchor[] {
  return artifact.sections.slice(0, 3).map((section, index) => {
    const coreIdea = compact(section.markdown.split(/(?<=[。！？!?])/).find((sentence) => compact(sentence).length >= 18) || section.markdown || section.heading);
    return {
      anchorId: `anchor-${index + 1}`,
      sectionKey: section.sectionKey,
      sectionHeading: compact(section.heading, 80),
      coreIdea,
      visualType: inferVisualType(`${section.heading} ${section.markdown}`),
      placementReason: index === 0 ? "承接文章核心判断" : index === 1 ? "解释关键机制或变化" : "强化落地路径或读者记忆"
    };
  });
}

export function buildWechatCoverPrompt(input: {
  artifact: ContentDraftArtifact;
  route: WechatVisualStyleRoute;
  productName: string;
  targetAudience: string;
}) {
  const selected = style(input.route.styleId);
  const sectionStructure = input.artifact.sections.slice(0, 4).map((section) => compact(section.heading, 40)).join("、");
  return [
    "生成一张微信公众号文章封面主视觉。",
    `文章标题语义：${compact(input.artifact.selectedTitle, 120)}。`,
    `文章摘要：${compact(input.artifact.summary, 240)}。`,
    `目标读者：${compact(input.targetAudience || "企业 AI 落地相关的业务、产品和技术负责人", 120)}。`,
    `涉及产品：${compact(input.productName || "JOTO", 80)}。`,
    `主要结构：${sectionStructure || "核心判断、机制解释、行动路径"}。`,
    `视觉路线：${input.route.routeName}；目标是${input.route.visualIntent}。`,
    `采用${selected.styleName}：${selected.visualAnchor}。`,
    "画面比例为约 2.35:1 的超宽横版。左侧 38% 保留干净标题安全区，右侧 62% 放置核心视觉；主体不能被上下裁切破坏。",
    "图片中不要生成正式中文标题、段落、字母、数字、logo、水印、平台角标或二维码；标题由系统在公众号卡片中呈现。",
    "只表达一个核心判断，最多 3 到 5 个主要视觉元素。专业、克制、可信，适合企业微信公众号，不做 PPT、课程封面或廉价科技海报。",
    "不得编造客户、数据、排名、产品界面、认证、合作关系或效果承诺；不得出现个人隐私和内部生产标识。"
  ].join("\n");
}
