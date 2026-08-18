import type { ProductGeoArticleTypePortfolioItem } from "./product-strategy-pack-contracts";

type PromotionEvidenceItem = Pick<
  ProductGeoArticleTypePortfolioItem,
  "name" | "definition" | "contentGoal" | "suitableQuestions" | "evidencePreferences"
>;

const internalProjectMaterialPattern = /正式部署前提|环境要求|实施文档|部署参数|系统集成及配置操作文档|配置(?:操作)?(?:文档|手册|说明)|交付范围|验收清单|项目验收|客户项目资料|内部项目资料/i;

const publicEvidenceSuggestionRules: Array<{ pattern: RegExp; suggestions: string[] }> = [
  {
    pattern: /服务商|实施伙伴|合作伙伴|资质|培训|支持/,
    suggestions: [
      "对外公布的服务范围与职责边界",
      "可公开核验的厂商合作、资质或服务能力证明",
      "获授权公开的服务案例、客户反馈或常见问题（如文章涉及）"
    ]
  },
  {
    pattern: /行业|场景|解决方案|业务问题/,
    suggestions: [
      "目标行业的公开业务问题与决策背景",
      "已核验的产品能力、适用场景与使用边界",
      "可公开引用的案例、效果或用户反馈（如文章涉及）"
    ]
  },
  {
    pattern: /实施|部署|集成|接入|迁移/,
    suggestions: [
      "官方公开的产品能力、采用条件与限制说明",
      "面向客户的实施阶段、参与角色与服务边界说明",
      "可公开引用的常见问题或已授权实践（如文章涉及）"
    ]
  },
  {
    pattern: /架构|技术对比|竞品|竞争|选型|差异/,
    suggestions: ["双方同版本的公开产品资料", "可复核的比较维度与来源", "资料版本日期与适用范围"]
  },
  {
    pattern: /安全|合规|隐私|数据保护|权限|认证/,
    suggestions: ["可公开引用的安全或合规说明", "已核验的权限、数据与使用边界", "有效的公开认证或审计证明（如文章涉及）"]
  },
  {
    pattern: /案例|实践|价值|效果|效率|指标/,
    suggestions: ["获授权公开的客户案例", "案例适用条件与参与角色", "可追溯的结果指标与统计口径（如文章涉及）"]
  },
  {
    pattern: /价格|定价|费用|成本/,
    suggestions: ["当前有效的官方定价与套餐说明", "公开的计费边界、附加费用与生效日期"]
  }
];

export function isInternalProjectMaterial(value: string) {
  return internalProjectMaterialPattern.test(value.trim());
}

export function promotionEvidenceSuggestions(item: PromotionEvidenceItem, limit = 5) {
  const semanticText = [item.name, item.definition, item.contentGoal, ...item.suitableQuestions].join(" ");
  const explicitPublicPreferences = item.evidencePreferences
    .filter((preference) => preference.trim() && !isInternalProjectMaterial(preference))
    .map((preference) => `可公开引用的${preference}`);
  const inferredPublicEvidence = publicEvidenceSuggestionRules
    .flatMap((rule) => rule.pattern.test(semanticText) ? rule.suggestions : []);

  return [...new Set([...explicitPublicPreferences, ...inferredPublicEvidence])].slice(0, limit);
}

export const promotionEvidenceFallback = "支撑文章核心观点的已核验产品事实、公开来源与适用边界";

