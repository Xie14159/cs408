#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 408Lab 导出的 wrongbook_latest.json 压成「豆包能一口气读完」的纯文本清单。

产出（都在 exports/ 下）：
  错题速览.md          统计 + 高频考点，一页看完
  错题清单_全部.md      每题一行
  错题清单_<科目>.md    按科目拆成 4 个更小的文件
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter

EXPORT_DIR = os.path.dirname(os.path.abspath(__file__)).replace("scripts", "exports")
SRC = os.path.join(EXPORT_DIR, "wrongbook_latest.json")

SUBJECT_ORDER = [("co", "计算机组成原理"), ("os", "操作系统"), ("ds", "数据结构"), ("cn", "计算机网络")]


def clean(text: str, limit: int = 52) -> str:
    text = (text or "").replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def main() -> None:
    data = json.load(open(SRC, encoding="utf-8"))
    items = data.get("items") or []
    summary = data.get("summary") or {}
    exported = data.get("exportedAt", "")

    lines_all = []
    by_subject: dict[str, list[str]] = {k: [] for k, _ in SUBJECT_ORDER}
    topic_counter: Counter = Counter()
    tag_counter: Counter = Counter()

    for idx, it in enumerate(items, 1):
        subj = it.get("subject", "")
        topic = it.get("topic") or "未分类"
        topic_counter[(subj, topic)] += 1
        tag_counter[it.get("errorTag") or "未标"] += 1
        head = (
            f"{idx:03d} {it.get('qid','')} {it.get('year','')}年 "
            f"{it.get('subjectName', subj)} {topic} "
            f"错{it.get('wrong',0)}次 阶段{it.get('stage',0)} {it.get('errorTag','')}"
        )
        stem = clean(it.get("stem") or it.get("question") or "", 52)
        line = f"{head} | {stem}"
        lines_all.append(line)
        if subj in by_subject:
            by_subject[subj].append(line)

    os.makedirs(EXPORT_DIR, exist_ok=True)

    # 1) 速览
    o = []
    o.append("# 408Lab 错题速览")
    o.append("")
    o.append(f"- 导出时间：{exported}　时区：{data.get('timezone','')}")
    o.append(f"- 总数 **{summary.get('total', len(items))}** 道；待巩固 **{summary.get('pending','?')}**；已掌握 **{summary.get('mastered','?')}**")
    o.append("")
    o.append("## 各科目")
    o.append("")
    o.append("| 科目 | 道数 |")
    o.append("|---|---:|")
    for key, name in SUBJECT_ORDER:
        o.append(f"| {name} | {len(by_subject[key])} |")
    o.append("")
    o.append("## 高频考点（前 15）")
    o.append("")
    o.append("| 科目 | 考点 | 道数 |")
    o.append("|---|---|---:|")
    for (subj, topic), n in topic_counter.most_common(15):
        name = dict(SUBJECT_ORDER).get(subj, subj)
        o.append(f"| {name} | {topic} | {n} |")
    o.append("")
    o.append("## 错因分布")
    o.append("")
    o.append("| 错因 | 道数 |")
    o.append("|---|---:|")
    for tag, n in tag_counter.most_common():
        o.append(f"| {tag} | {n} |")
    o.append("")
    o.append("> 每题的完整信息见 `错题清单_全部.md` 或分科目文件；原始 JSON 是 `wrongbook_latest.json`。")
    open(os.path.join(EXPORT_DIR, "错题速览.md"), "w", encoding="utf-8").write("\n".join(o) + "\n")

    # 2) 全部 + 分科目
    header = "# 错题清单（每题一行：序号 题号 年份 科目 考点 错次 阶段 错因 | 题干）\n\n"
    open(os.path.join(EXPORT_DIR, "错题清单_全部.md"), "w", encoding="utf-8").write(
        header + "\n".join(lines_all) + "\n"
    )
    for key, name in SUBJECT_ORDER:
        if not by_subject[key]:
            continue
        body = f"# 错题清单 · {name}（{len(by_subject[key])} 道）\n\n" + "\n".join(by_subject[key]) + "\n"
        open(os.path.join(EXPORT_DIR, f"错题清单_{name}.md"), "w", encoding="utf-8").write(body)

    print("条数", len(items), "| 待巩固", summary.get("pending"), "| 已掌握", summary.get("mastered"))
    for f in sorted(os.listdir(EXPORT_DIR)):
        if f.startswith("错题"):
            p = os.path.join(EXPORT_DIR, f)
            print(f"  {f:28s} {os.path.getsize(p)/1024:7.1f} KB")


if __name__ == "__main__":
    main()
