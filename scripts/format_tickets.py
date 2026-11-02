# Приводит конспекты билетов к стилю сайта: заголовок вопроса, подзаголовки,
# выделение терминов, нумерованные перечни. Содержание не переписывается.
# Запуск: python scripts/format_tickets.py materials/developmental-psych/content/tickets.json

import html
import json
import re
import sys


HEAD_RE = re.compile(r'^(Теория|Концепция|Подход|Стадии|Стадия|Этапы|Этап|Функции|Структура|Виды|Типы|Тип|Методы|Принципы|Критерии|Компоненты|Уровни)\b', re.I)
LEAD_RE = re.compile(r'^([^<>{}\[\]]{2,70}?)(\s*[—–-]\s+|\s*:\s+)(.+)$')


def esc(text):
    return html.escape(text, quote=False)


def is_heading(text):
    t = text.strip()
    if t.endswith(':'):
        return True
    if HEAD_RE.match(t) and len(t) <= 120:
        return True
    return False


def bold_lead(text):
    m = LEAD_RE.match(text)
    if not m:
        return esc(text)
    left, sep, rest = m.group(1), m.group(2), m.group(3)
    if len(left.split()) > 7:
        return esc(text)
    if left.strip().endswith(('.', '?', '!')):
        return esc(text)
    if sep.strip() == ':':
        return '<b>' + esc(left.strip()) + ':</b> ' + esc(rest)
    return '<b>' + esc(left.strip()) + '</b>' + esc(sep) + esc(rest)


def split_enumeration(text):
    parts = re.split(r'(?=\b\d{1,2}\)\s)', text.strip())
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 2:
        return None
    items = []
    for part in parts:
        part = re.sub(r'^\d{1,2}\)\s*', '', part)
        if part:
            items.append('<li>' + esc(part) + '</li>')
    return '<ol>' + ''.join(items) + '</ol>' if len(items) >= 2 else None


def process_paragraph(text):
    t = text.strip()
    if not t:
        return ''
    if is_heading(t):
        return '<h4>' + esc(t.rstrip(':. ')) + '</h4>'
    enum = split_enumeration(t)
    if enum:
        return enum
    return '<p>' + bold_lead(t) + '</p>'


def format_content(number, title, content):
    blocks = re.findall(r'<(p|ul|ol)>(.*?)</\1>', content, re.S)
    out = ['<h3>Вопрос ' + esc(str(number)) + '. ' + esc(title) + '</h3>']
    pending = []

    def flush():
        if pending:
            out.append('<ul>' + ''.join('<li>' + bold_lead(x) + '</li>' for x in pending) + '</ul>')
            pending.clear()

    for tag, inner in blocks:
        if tag == 'p':
            text = re.sub(r'<[^>]+>', '', inner).strip()
            combo = re.match(r'^([^:]{2,60}:)\s*[-–—•]\s*(.+)$', text)
            if combo:
                flush()
                out.append('<p><b>' + esc(combo.group(1)) + '</b></p>')
                pending.append(combo.group(2))
                continue
            if re.match(r'^[-–—•]\s*', text):
                pending.append(re.sub(r'^[-–—•]\s*', '', text))
                continue
            flush()
            out.append(process_paragraph(text))
        elif tag == 'ul':
            flush()
            items = re.findall(r'<li>(.*?)</li>', inner, re.S)
            if not items:
                continue
            out.append('<ul>' + ''.join('<li>' + bold_lead(re.sub(r'<[^>]+>', '', i).strip()) + '</li>' for i in items) + '</ul>')
        else:
            flush()
            out.append('<' + tag + '>' + inner + '</' + tag + '>')
    flush()
    return ''.join(out)


def main(path):
    with open(path, encoding='utf-8') as f:
        tickets = json.load(f)
    changed = 0
    for t in tickets:
        if t['content'].lstrip().startswith('<h3>'):
            continue
        t['content'] = format_content(t['number'], t['title'], t['content'])
        changed += 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(tickets, f, ensure_ascii=False, indent=2)
    print(f'{path}: {len(tickets)} билетов, оформлено {changed}')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        main(p)
