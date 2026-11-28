# -*- coding: utf-8 -*-
"""
408Lab「到期真题 · 做题本」PDF 生成器。

输入：一个 JSON 文件（由 /api/worksheet 生成）
  { "date": "2026-11-28",
    "items": [{qid, year, number, subjectName, type, topic, score,
               question, code:{lang,text}|null, options:[...]|null, figure: 绝对路径|null}] }
输出：A4 无答案做题本 PDF（题干 + 选项 + 代码 + 配图 + 作答区），落盘到指定路径。

用法：python make_worksheet_pdf.py <input.json> <output.pdf>
stdout 最后一行输出 JSON：{"ok": true, "path": ..., "pages": n, "bytes": n}
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import traceback

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    CondPageBreak,
    Image,
    KeepTogether,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    XPreformatted,
)

PAGE_W, PAGE_H = A4
MARGIN_X = 16 * mm
MARGIN_TOP = 15 * mm
MARGIN_BOTTOM = 15 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

FONT_DIR = r"C:\Windows\Fonts"
GRAY = colors.HexColor("#6B7280")
LIGHT = colors.HexColor("#F3F4F6")
LINE = colors.HexColor("#D1D5DB")
INK = colors.HexColor("#111827")


def _register_fonts() -> tuple[str, str, str]:
    """注册中文字体；返回 (正文字体名, 粗体名, 代码字体名)。"""
    normal = None
    bold = None
    candidates_normal = [
        ("SS", os.path.join(FONT_DIR, "simsun.ttc"), 0),
        ("SS", os.path.join(FONT_DIR, "msyh.ttc"), 0),
        ("SS", os.path.join(FONT_DIR, "simhei.ttf"), None),
    ]
    for name, path, idx in candidates_normal:
        if not os.path.exists(path):
            continue
        try:
            if idx is None:
                pdfmetrics.registerFont(TTFont(name, path))
            else:
                pdfmetrics.registerFont(TTFont(name, path, subfontIndex=idx))
            normal = name
            break
        except Exception:
            continue
    for name, path, idx in [
        ("SB", os.path.join(FONT_DIR, "simhei.ttf"), None),
        ("SB", os.path.join(FONT_DIR, "msyhbd.ttc"), 0),
    ]:
        if not os.path.exists(path):
            continue
        try:
            if idx is None:
                pdfmetrics.registerFont(TTFont(name, path))
            else:
                pdfmetrics.registerFont(TTFont(name, path, subfontIndex=idx))
            bold = name
            break
        except Exception:
            continue
    if not normal:
        raise RuntimeError("找不到可用的中文字体")
    if not bold:
        bold = normal
    pdfmetrics.registerFontFamily("Song", normal=normal, bold=bold, italic=normal, boldItalic=bold)
    return normal, bold, "Courier"


def _compact(text: str, limit: int = 28) -> str:
    """把连续短行（原题拓扑/表格被拆成一行一个词）并成一行，避免一页只排十几个词。"""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out, buf = [], []
    for ln in lines:
        s = ln.strip()
        if not s:
            # 原题里拓扑信息是「一行一个词 + 空行分隔」，空行不能打断合并
            continue
        if len(s) <= limit:
            buf.append(s)
            continue
        if buf:
            out.append("  ".join(buf))
            buf = []
        out.append(ln)
    if buf:
        out.append("  ".join(buf))
    return "\n".join(out)


def _esc(text: str) -> str:
    """转义 XML 并保留行内标记：**加粗**、`代码`。"""
    s = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s, flags=re.S)
    s = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\n{2,}", "\n", s)
    s = s.replace("\n", "<br/>")
    return s


def _answer_height(score: float) -> float:
    """综合题作答区高度（mm），按分值给。"""
    if score >= 14:
        h = 92
    elif score >= 12:
        h = 84
    elif score >= 10:
        h = 72
    elif score >= 8:
        h = 62
    elif score >= 6:
        h = 50
    else:
        h = 40
    return h * mm


def _wrap_code(text: str, limit: int = 88) -> str:
    """代码块手动折行：Courier 8pt 在 174mm 版心上大约 90 字符，
    超过就会伸到页外（Preformatted 自己不会折）。"""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for ln in lines:
        if len(ln) > limit:
            while len(ln) > limit:
                out.append(ln[:limit])
                ln = ln[limit:]
            out.append(ln)
        else:
            out.append(ln)
    return "\n".join(out)


def _blank_box(height: float, rows: int = 0) -> Table:
    """横线作答框：外框 + 每 10mm 一条浅灰横线。"""
    if rows <= 0:
        rows = max(3, int(math.ceil(height / (10 * mm))))
    data = [[""] for _ in range(rows)]
    row_h = height / rows
    t = Table(data, colWidths=[CONTENT_W], rowHeights=[row_h] * rows)
    style = [
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#9CA3AF")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]
    for r in range(rows):
        style.append(("LINEBELOW", (0, r), (-1, r), 0.3, LINE))
    t.setStyle(TableStyle(style))
    return t


class _NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self._draw_footer(total)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_footer(self, total: int):
        self.setFont("SS", 8)
        self.setFillColor(GRAY)
        self.drawCentredString(PAGE_W / 2, 9 * mm, f"第 {self._pageNumber} 页 / 共 {total} 页")
        self.setStrokeColor(LINE)
        self.setLineWidth(0.4)
        self.line(MARGIN_X, 13 * mm, PAGE_W - MARGIN_X, 13 * mm)


def build(payload: dict, out_path: str) -> dict:
    body_font, bold_font, code_font = _register_fonts()

    st_h1 = ParagraphStyle("h1", fontName=bold_font, fontSize=18, leading=24, textColor=INK)
    st_sub = ParagraphStyle("sub", fontName=body_font, fontSize=9, leading=14, textColor=GRAY)
    st_meta = ParagraphStyle("meta", fontName=body_font, fontSize=9.5, leading=14, textColor=GRAY)
    st_body = ParagraphStyle("body", fontName=body_font, fontSize=10.5, leading=16.5, textColor=INK, alignment=TA_LEFT)
    st_opt = ParagraphStyle("opt", fontName=body_font, fontSize=10.5, leading=16, textColor=INK, leftIndent=8 * mm, firstLineIndent=-4 * mm)
    st_code = ParagraphStyle("code", fontName=code_font, fontSize=8, leading=10.5, textColor=colors.HexColor("#1F2937"))
    st_note = ParagraphStyle("note", fontName=body_font, fontSize=8.5, leading=12, textColor=GRAY)

    items = payload.get("items") or []
    date = payload.get("date") or ""
    if not items:
        raise RuntimeError("没有可导出的题")

    single = [x for x in items if x.get("type") == "single"]
    apps = [x for x in items if x.get("type") != "single"]
    ordered = single + apps

    minutes = sum(2 for _ in single) + sum(max(3, round(float(x.get("score") or 0))) for x in apps)
    total_score = sum(float(x.get("score") or 0) for x in ordered)

    doc = SimpleDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title=f"408 每日错题做题本 {date}",
        author="408Lab",
    )

    story = []
    story.append(Paragraph("408 每日错题做题本", st_h1))
    story.append(Spacer(1, 3 * mm))
    story.append(
        Paragraph(
            f"{date}　·　共 {len(ordered)} 道（单选 {len(single)} / 综合 {len(apps)}）　·　合计 {total_score:g} 分　·　建议 {minutes} 分钟",
            st_sub,
        )
    )
    story.append(Spacer(1, 2 * mm))
    rule = Table([[""]], colWidths=[CONTENT_W], rowHeights=[0.6 * mm])
    rule.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 1.2, INK)]))
    story.append(rule)
    story.append(Spacer(1, 4 * mm))
    story.append(
        Paragraph(
            "做题本只含题干与作答区，不含答案。先独立写，写完再回 408Lab 核对；单选在字母上打勾，综合题按分值留白作答。",
            st_note,
        )
    )
    story.append(Spacer(1, 5 * mm))

    for idx, item in enumerate(ordered, 1):
        year = item.get("year") or 0
        origin = item.get("yearLabel") or ""
        if year:
            src = f"{year} 年第 {item.get('number')} 题"
        else:
            src = origin or "精选题"
        kinds = "单选题" if item.get("type") == "single" else "综合应用"
        meta = f"{src}　·　{item.get('subjectName') or ''}　·　{kinds}　·　{item.get('score') or 0:g} 分"
        num_style = ParagraphStyle(
            "num", fontName=body_font, fontSize=13, leading=16, textColor=colors.HexColor("#111827")
        )
        head = Table(
            [[Paragraph(f"{idx:02d}", num_style), Paragraph(_esc(meta), st_meta)]],
            colWidths=[11 * mm, CONTENT_W - 11 * mm],
        )
        head.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ]
            )
        )

        parts = [CondPageBreak(58 * mm), head, Spacer(1, 1.5 * mm)]

        # 配图先于题干：原卷图是整题截图，放后面容易被长题干挤到下一页
        fig = item.get("figure")
        if fig and os.path.exists(fig):
            try:
                iw, ih = ImageReader(fig).getSize()
                w = min(CONTENT_W, 105 * mm)
                h = w * ih / max(1, iw)
                max_h = 70 * mm
                if h > max_h:
                    h = max_h
                    w = h * iw / max(1, ih)
                parts.append(Image(fig, width=w, height=h))
                parts.append(Spacer(1, 2.5 * mm))
            except Exception:
                pass

        parts.append(Paragraph(_esc(_compact(item.get("question") or "")), st_body))

        code = item.get("code") or None
        if code and (code.get("text") or "").strip():
            story_parts = []
            code_para = Preformatted(_wrap_code(code.get("text") or ""), st_code)
            code_box = Table([[code_para]], colWidths=[CONTENT_W])
            code_box.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ]
                )
            )
            parts.append(Spacer(1, 1.5 * mm))
            parts.append(code_box)

        opts = item.get("options") or []
        if opts:
            parts.append(Spacer(1, 2 * mm))
            for j, opt in enumerate(opts):
                letter = "ABCD"[j] if j < 4 else str(j + 1)
                parts.append(Paragraph(f"{letter}.　{_esc(opt)}", st_opt))
            parts.append(Spacer(1, 2.5 * mm))
            parts.append(
                Paragraph("作答：○ A　　○ B　　○ C　　○ D", ParagraphStyle(
                    "pick", fontName=body_font, fontSize=9.5, leading=14, textColor=GRAY
                ))
            )
        else:
            parts.append(Spacer(1, 2 * mm))
            # 作答区可能被推到下一页，框上方重复题号，避免出现「无标题的横线页」
            label = Paragraph(
                f"作答区 · 第 {idx:02d} 题（{float(item.get('score') or 0):g} 分）",
                st_note,
            )
            parts.append(
                KeepTogether([label, Spacer(1, 1.2 * mm), _blank_box(_answer_height(float(item.get("score") or 0)))])
            )
        parts.append(Spacer(1, 6 * mm))

        story.extend(parts)

    doc.build(story, canvasmaker=_NumberedCanvas)

    try:
        import pymupdf  # type: ignore

        pages = pymupdf.open(out_path).page_count
    except Exception:
        pages = 0
    return {"ok": True, "path": out_path, "pages": pages, "bytes": os.path.getsize(out_path)}


def _esc_plain(text: str) -> str:
    s = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return s.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>")


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "用法: make_worksheet_pdf.py <input.json> <output.pdf>"}, ensure_ascii=False))
        sys.exit(2)
    inp, out = sys.argv[1], sys.argv[2]
    try:
        payload = json.load(open(inp, encoding="utf-8"))
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        res = build(payload, out)
        print(json.dumps(res, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
