/**
 * The per-division training series published under /training.
 *
 * Same contract as src/lib/atcRules.ts: divisions come from
 * `SELECTABLE_REGIONS`, and a curriculum is only linkable once its MDX exists
 * in the `training` content collection. Material ids are the collection ids
 * under the division folder (`training/<division>/<id>.mdx`).
 *
 * Titles and summaries are stored in the document's own language — a division
 * writes its materials in its language and the shell around them stays
 * localised. A material may appear in more than one group (17 is Radio for
 * the S2 track and FSS for the C1 track); `groups` holds ids, so listing it
 * twice costs nothing.
 *
 * Browser-safe: no astro:content import.
 */

// `division.region` 里成员可加入的五个分部，0（全网）不在其中。
export const SELECTABLE_REGIONS = [1, 2, 3, 4, 5] as const;

export interface TrainingMaterial {
  /** Collection id under the division folder, and the URL segment. */
  id: string;
  /** Series number as printed on the document ("00" … "23"). */
  no: string;
  title: string;
  summary: string;
}

export interface TrainingGroup {
  key: string;
  title: string;
  /** Material ids, in the order the curriculum teaches them. */
  items: string[];
}

export interface TrainingCurriculum {
  /** `division.region` — 1 PRC, 2 USA, 3 JPN, 4 HKG, 5 ROC. */
  region: number;
  /** URL segment and the collection folder name. */
  key: string;
  title: string;
  /** BCP-47 tag of the documents, labelled via `training.languages.<lang>` in this site's dictionary. */
  lang: string;
  /** Not yet ratified by the division — the UI badges it. */
  draft?: boolean;
  /** Recommended study order, in the document language. */
  order: string;
  /** Material id of the series overview, shown ahead of the groups. */
  overviewId: string;
  materials: TrainingMaterial[];
  groups: TrainingGroup[];
}

const JPN_MATERIALS: TrainingMaterial[] = [
  {
    id: "00-study-guide",
    no: "00",
    title: "学習ガイド",
    summary: "学習方法、判断サイクル、資料体系",
  },
  {
    id: "01-basics-comms-weather",
    no: "01",
    title: "管制の基本・通信・気象",
    summary: "通信優先度、気象、QNH",
  },
  {
    id: "02-ifr-clearance-separation",
    no: "02",
    title: "IFR管制承認・間隔・待機",
    summary: "間隔と待機の理論",
  },
  {
    id: "03-aerodrome-control-radio",
    no: "03",
    title: "飛行場管制・Radio",
    summary: "飛行場管制の共通基礎",
  },
  {
    id: "04-radar-identification",
    no: "04",
    title: "レーダー識別・誘導・移送",
    summary: "識別、ベクター、移管",
  },
  {
    id: "05-departure-arrival-approach",
    no: "05",
    title: "出発・到着・進入",
    summary: "DEP／APP／TWRの統合",
  },
  {
    id: "06-enroute-fss-oceanic",
    no: "06",
    title: "航空路・FSS・洋上管制",
    summary: "非レーダー間隔、洋上管制",
  },
  {
    id: "07-emergency-comm-failure",
    no: "07",
    title: "緊急・通信途絶・機器障害",
    summary: "緊急、通信途絶、障害",
  },
  {
    id: "08-ojt-assessment",
    no: "08",
    title: "OJT実践・評価基準",
    summary: "OJT実施、教官介入、評価",
  },
  {
    id: "09-phraseology-readback",
    no: "09",
    title: "基本用語・数字・標準応答",
    summary: "独立必修、数字、復唱、訂正",
  },
  {
    id: "10-coordination-handoff",
    no: "10",
    title: "席間調整・ハンドオフ",
    summary: "調整、受入れ、移管、閉局",
  },
  {
    id: "11-del-flightplan",
    no: "11",
    title: "DEL・フライトプラン審査",
    summary: "IFR承認、SID、暫定高度",
  },
  {
    id: "12-gnd-taxi-runway-safety",
    no: "12",
    title: "GND・地上走行・滑走路安全",
    summary: "プッシュバック、走行、横断",
  },
  {
    id: "13-twr-runway-circuit",
    no: "13",
    title: "TWR・滑走路・場周管制",
    summary: "離着陸、場周、SVFR",
  },
  {
    id: "14-dep-radar-departure",
    no: "14",
    title: "DEP・レーダー出発管制",
    summary: "出発流、上昇、SID逸脱",
  },
  {
    id: "15-app-arrival-sequencing",
    no: "15",
    title: "APP・到着順位・進入管制",
    summary: "到着順位、進入、待機",
  },
  {
    id: "16-ctr-enroute-nonradar",
    no: "16",
    title: "CTR・航空路・ノンレーダー空港",
    summary: "航空路、ノンレーダー、IFR取消し",
  },
  {
    id: "17-radio-fss-practice",
    no: "17",
    title: "Radio・FSS実務詳説",
    summary: "Radio部分はS2 Optional相当、FSS部分はC1 Optional相当",
  },
  {
    id: "18-practical-scenarios",
    no: "18",
    title: "総合実技シナリオ・教官用採点表",
    summary: "統合実技、採点、デブリーフィング",
  },
  {
    id: "19-orientation-observation",
    no: "19",
    title: "導入・見学・管制員の心得",
    summary: "見学、訓練段階、服務、自己管理",
  },
  {
    id: "20-client-voice",
    no: "20",
    title: "管制クライアント・音声",
    summary: "接続準備、タグ、音声、障害対応",
  },
  {
    id: "21-vfr-tca-traffic",
    no: "21",
    title: "VFR・TCA・交通情報",
    summary: "VFR、管制圏通過、TCA",
  },
  {
    id: "22-eaip-charts-data",
    no: "22",
    title: "eAIP・チャート・管制データ",
    summary: "eAIP、NOTAM、チャート、データシート",
  },
  {
    id: "23-atis-operations",
    no: "23",
    title: "ATIS作成・更新・運用",
    summary: "情報源、構成、更新、調整、引継ぎ",
  },
];

export const TRAINING_CURRICULA: TrainingCurriculum[] = [
  {
    region: 3,
    key: "jpn",
    title: "CAN JPN 管制教材シリーズ",
    lang: "ja",
    draft: true,
    order:
      "推奨共通順序は 00 → 19 → 20 → 23 → 09 → 01 → 10 → 対象席の専門課程 → 07 → 08 → 18。教材22はすべての段階で資料確認に使用する。",
    overviewId: "overview",
    materials: JPN_MATERIALS,
    groups: [
      {
        key: "A",
        title: "導入・環境設定",
        items: [
          "00-study-guide",
          "19-orientation-observation",
          "20-client-voice",
          "23-atis-operations",
        ],
      },
      {
        key: "B",
        title: "全レーティング共通",
        items: [
          "09-phraseology-readback",
          "01-basics-comms-weather",
          "10-coordination-handoff",
          "07-emergency-comm-failure",
        ],
      },
      {
        key: "C",
        title: "S2相当・飛行場管制",
        items: [
          "11-del-flightplan",
          "12-gnd-taxi-runway-safety",
          "03-aerodrome-control-radio",
          "13-twr-runway-circuit",
          "21-vfr-tca-traffic",
          "17-radio-fss-practice",
        ],
      },
      {
        key: "D",
        title: "S3相当・進入／出発管制",
        items: [
          "04-radar-identification",
          "14-dep-radar-departure",
          "15-app-arrival-sequencing",
          "05-departure-arrival-approach",
          "02-ifr-clearance-separation",
        ],
      },
      {
        key: "E",
        title: "C1相当・航空路／FSS",
        items: [
          "16-ctr-enroute-nonradar",
          "06-enroute-fss-oceanic",
          "17-radio-fss-practice",
        ],
      },
      {
        key: "F",
        title: "OJT・評価",
        items: ["08-ojt-assessment", "18-practical-scenarios"],
      },
      {
        key: "G",
        title: "管制官向けデータ集",
        items: ["22-eaip-charts-data"],
      },
    ],
  },
];

export interface TrainingDivision {
  region: number;
  /** Undefined until that division publishes a curriculum. */
  curriculum?: TrainingCurriculum;
  href?: string;
  /** Materials actually present in the collection, overview excluded. */
  materialCount?: number;
}

export function curriculumHref(curriculum: TrainingCurriculum): string {
  return `/training/${curriculum.key}`;
}

export function materialHref(
  curriculum: TrainingCurriculum,
  material: TrainingMaterial,
): string {
  return `/training/${curriculum.key}/${material.id}`;
}

/** Collection id of a material — the loader keys them by folder path. */
function collectionId(curriculum: TrainingCurriculum, id: string): string {
  return `${curriculum.key}/${id}`;
}

/** Every joinable division, in region order, with its curriculum if published. */
export function buildTrainingDivisions(
  /** Ids present in the `training` collection. */
  availableIds: string[],
): TrainingDivision[] {
  return SELECTABLE_REGIONS.map((region) => {
    const curriculum = TRAINING_CURRICULA.find(
      (candidate) =>
        candidate.region === region &&
        availableIds.includes(collectionId(candidate, candidate.overviewId)),
    );
    if (!curriculum) return { region };
    return {
      region,
      curriculum,
      href: curriculumHref(curriculum),
      materialCount: curriculum.materials.filter((material) =>
        availableIds.includes(collectionId(curriculum, material.id)),
      ).length,
    };
  });
}

export function findCurriculum(
  key: string | undefined,
): TrainingCurriculum | undefined {
  if (!key) return undefined;
  return TRAINING_CURRICULA.find((curriculum) => curriculum.key === key);
}

export function findMaterial(
  curriculum: TrainingCurriculum,
  id: string | undefined,
  availableIds: string[],
): TrainingMaterial | undefined {
  if (!id || !availableIds.includes(collectionId(curriculum, id))) {
    return undefined;
  }
  return curriculum.materials.find((material) => material.id === id);
}

export interface ResolvedGroup extends TrainingGroup {
  materials: TrainingMaterial[];
}

/** Groups with their materials resolved, skipping any whose MDX is missing. */
export function resolveGroups(
  curriculum: TrainingCurriculum,
  availableIds: string[],
): ResolvedGroup[] {
  return curriculum.groups
    .map((group) => ({
      ...group,
      materials: group.items
        .map((id) => curriculum.materials.find((m) => m.id === id))
        .filter(
          (material): material is TrainingMaterial =>
            !!material &&
            availableIds.includes(collectionId(curriculum, material.id)),
        ),
    }))
    .filter((group) => group.materials.length > 0);
}
