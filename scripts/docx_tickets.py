# Конвертер DOCX с вопросами и ответами в tickets.json.
# Вопросы — абзацы со стилем Heading (1/2/3), ответ — всё до следующего заголовка.
# Запуск:
#   python scripts/docx_tickets.py --input file.docx --out materials/x/content/tickets.json
#       [--offset 18] [--start 19] [--discipline general-psych]

import argparse
import html
import json
import os
import re
import sys

from docx import Document


def clean_title(text):
    text = re.sub(r'^\s*\d{1,3}[.)]\s*', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def paragraphs_to_html(items):
    out = []
    in_list = False
    for text, style, bold in items:
        t = text.strip()
        if not t:
            continue
        is_item = style.startswith('List Paragraph') or re.match(r'^[-–—•]\s+', t)
        if is_item:
            if not in_list:
                out.append('<ul>')
                in_list = True
            t = re.sub(r'^[-–—•]\s+', '', t)
            out.append('<li>' + html.escape(t) + '</li>')
            continue
        if in_list:
            out.append('</ul>')
            in_list = False
        out.append('<p>' + html.escape(t) + '</p>')
    if in_list:
        out.append('</ul>')
    return ''.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--offset', type=int, default=0)
    ap.add_argument('--start', type=int, default=None)
    ap.add_argument('--discipline', default=None)
    ap.add_argument('--time', default=None)
    args = ap.parse_args()

    doc = Document(args.input)
    entries = []
    current = None

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            continue
        style = p.style.name or ''
        bold = bool(p.runs) and all(r.bold for r in p.runs if r.text.strip())
        if style.startswith('Heading'):
            if current:
                entries.append(current)
            current = {'title': clean_title(text), 'items': []}
        elif current is not None:
            current['items'].append((text, style, bold))
    if current:
        entries.append(current)

    discipline = args.discipline
    if not discipline:
        m = re.search(r'materials[\\/]([^\\/]+)[\\/]content', os.path.abspath(args.out))
        discipline = m.group(1) if m else None

    tickets = []
    for entry in entries:
        body = paragraphs_to_html(entry['items'])
        if len(body) < 40:
            print('  пропуск (нет ответа):', entry['title'][:70])
            continue
        number = (args.start + len(tickets)) if args.start else (args.offset + len(tickets) + 1)
        length = len(body)
        recommend = args.time or ('10–15 минут' if length < 2500 else '20–25 минут')
        tickets.append({
            'discipline_id': discipline,
            'number': str(number),
            'title': entry['title'],
            'recommend_time': recommend,
            'plan': None,
            'content': body,
        })

    out_dir = os.path.dirname(args.out)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)

    print(f'{os.path.basename(args.input)}: заголовков {len(entries)}, билетов {len(tickets)} -> {args.out}')
    for t in tickets[:3]:
        print('  ', t['number'], '|', t['title'][:80], '| html', len(t['content']))


if __name__ == '__main__':
    sys.exit(main())
