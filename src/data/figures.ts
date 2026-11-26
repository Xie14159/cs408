/**
 * 真题配图登记表：qid → public/ 下的图片路径。
 *
 * 题干的文字层是完整的，但原卷里的图（网络拓扑、数据通路、页表结构、目录树……）
 * 没法用文字表达，所以按题号把原卷图裁出来放进 public/figures/。
 *
 * 只登记真正需要看图的题；没有登记的题按原逻辑显示「原卷配图未随题库收录」提示。
 * 图片来源：C:\Users\Xie\Downloads\408真题\{年份}年计算机408统考真题.pdf，按题裁切。
 */
export const FIGURES: Record<string, string> = {
  'q-2014-42': '/figures/q-2014-42.png',
  // 2014 第 43 题的“路由表”是空表（要考生填），它真正依赖的是题 42 图的网络拓扑
  'q-2014-43': '/figures/q-2014-42.png',
  'q-2014-44': '/figures/q-2014-44.png',
  'q-2015-42': '/figures/q-2015-42.png',
  'q-2015-43': '/figures/q-2015-43.png',
  'q-2015-44': '/figures/q-2015-44.png',
  'q-2015-47': '/figures/q-2015-47.png',
  // 2016 第 33~41 题共用一张网络拓扑（原卷「题 33~41 图」）
  'q-2016-33': '/figures/q-2016-33.png',
  'q-2016-34': '/figures/q-2016-33.png',
  'q-2016-35': '/figures/q-2016-33.png',
  'q-2016-36': '/figures/q-2016-33.png',
  'q-2016-37': '/figures/q-2016-33.png',
  'q-2016-38': '/figures/q-2016-33.png',
  'q-2016-39': '/figures/q-2016-33.png',
  'q-2016-40': '/figures/q-2016-33.png',
  'q-2016-41': '/figures/q-2016-33.png',
  'q-2016-45': '/figures/q-2016-45.png',
  'q-2016-47': '/figures/q-2016-47.png',
  // 2023 卷本地只有解析版（无原图），此图由用户提供截图后裁切
  'q-2023-41': '/figures/q-2023-41.png',
  'q-2023-45': '/figures/q-2023-45.png',
  'q-2023-47': '/figures/q-2023-47.png',
  // 2024 卷是带水印扫描版，图由用户截取
  'q-2024-44': '/figures/q-2024-44.png',
  'q-2024-47': '/figures/q-2024-47.png',
  // 2025 卷本地缺失，图由用户截取
  'q-2025-46': '/figures/q-2025-46.png',
  // 2009–2022 补图（逐页定位后裁切）
  'q-2009-44': '/figures/q-2009-44.png',
  'q-2009-46': '/figures/q-2009-46.png',
  'q-2009-47': '/figures/q-2009-47.png',
  'q-2010-45': '/figures/q-2010-45.png',
  'q-2010-46': '/figures/q-2010-46.png',
  'q-2011-44': '/figures/q-2011-44.png',
  'q-2011-47': '/figures/q-2011-47.png',
  'q-2012-42': '/figures/q-2012-42.png',
  'q-2012-44': '/figures/q-2012-44.png',
  // 2013-44 含两页内容（指令格式/机器码表 + 数据通路图），已拼成一张
  'q-2013-44': '/figures/q-2013-44.png',
  'q-2013-46': '/figures/q-2013-46.png',
  'q-2013-47': '/figures/q-2013-47.png',
  'q-2017-44': '/figures/q-2017-44.png',
  'q-2017-47': '/figures/q-2017-47.png',
  'q-2018-42': '/figures/q-2018-42.png',
  'q-2018-44': '/figures/q-2018-44.png',
  // 2018 第 45 题「请根据题 44 图…」，与 44 共用同一张图
  'q-2018-45': '/figures/q-2018-44.png',
  'q-2018-47': '/figures/q-2018-47.png',
  'q-2019-47': '/figures/q-2019-47.png',
  'q-2020-47': '/figures/q-2020-47.png',
  'q-2021-45': '/figures/q-2021-45.png',
  'q-2021-47': '/figures/q-2021-47.png',
  'q-2022-41': '/figures/q-2022-41.png',
  'q-2022-43': '/figures/q-2022-43.png',
  'q-2022-46': '/figures/q-2022-46.png',
  'q-2022-47': '/figures/q-2022-47.png',
}

export function figureFor(qid: string): string | null {
  return FIGURES[qid] ?? null
}
