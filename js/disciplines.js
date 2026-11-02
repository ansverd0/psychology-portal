// Сгенерировано из materials/disciplines.json — не править вручную.
// Пересборка: node scripts/build-disciplines.mjs

window.PSY_DISCIPLINES = {
    "general-psych": {
        "title": "Общая психология",
        "short": "Общая",
        "icon": "🧠",
        "course": 1,
        "order": 10
    },
    "intro-profession": {
        "title": "Введение в профессиональную деятельность",
        "short": "Введение",
        "icon": "🚪",
        "course": 1,
        "order": 20
    },
    "developmental-psych": {
        "title": "Психология развития и возрастная психология",
        "short": "Возрастная",
        "icon": "🌱",
        "course": 2,
        "order": 30
    },
    "social-psych": {
        "title": "Социальная психология",
        "short": "Социальная",
        "icon": "👥",
        "course": 2,
        "order": 40
    },
    "psychophysiology": {
        "title": "Психофизиология",
        "short": "Психофизиология",
        "icon": "⚡",
        "course": 2,
        "order": 50
    },
    "psychodiagnostics": {
        "title": "Психолого-педагогическая диагностика",
        "short": "Психодиагностика",
        "icon": "📊",
        "course": 2,
        "order": 60
    },
    "pedagogical-psych": {
        "title": "Педагогическая психология",
        "short": "Педагогическая",
        "icon": "🎓",
        "course": 2,
        "order": 70
    },
    "defectology": {
        "title": "Дефектология",
        "short": "Дефектология",
        "icon": "🧷",
        "course": 2,
        "order": 80
    },
    "experimental-psych": {
        "title": "Экспериментальная психология",
        "short": "Экспериментальная",
        "icon": "🔬",
        "course": 2,
        "order": 90
    },
    "research-methods": {
        "title": "Качественные и количественные методы исследования",
        "short": "Методы исследования",
        "icon": "📈",
        "course": 2,
        "order": 100
    },
    "conflictology": {
        "title": "Конфликтология",
        "short": "Конфликтология",
        "icon": "🤝",
        "course": 3,
        "order": 110
    },
    "neuropsychology": {
        "title": "Нейропсихология",
        "short": "Нейропсихология",
        "icon": "🧩",
        "course": 3,
        "order": 120
    },
    "clinical-child-psych": {
        "title": "Клиническая психология детей и подростков",
        "short": "Клиническая",
        "icon": "🩺",
        "course": 3,
        "order": 130
    },
    "special-psych": {
        "title": "Специальная психология",
        "short": "Специальная",
        "icon": "♿",
        "course": 3,
        "order": 140
    },
    "differential-psych": {
        "title": "Дифференциальная психология",
        "short": "Дифференциальная",
        "icon": "🎭",
        "course": 3,
        "order": 150
    },
    "psychocorrection": {
        "title": "Основы психологической коррекции",
        "short": "Психокоррекция",
        "icon": "🛠",
        "course": 3,
        "order": 160
    }
};

window.PSY_ALIASES = {
    "general-exam": "general-psych",
    "social-exam": "social-psych",
    "developmental-exam": "developmental-psych",
    "ppd": "psychodiagnostics",
    "ped-psych": "pedagogical-psych",
    "age-psych": "developmental-psych"
};

window.psyDiscipline = function (id) {
    var key = window.PSY_ALIASES[id] || id;
    var d = window.PSY_DISCIPLINES[key];
    if (d) {
        return { id: key, title: d.title, short: d.short, icon: d.icon, course: d.course, order: d.order };
    }
    return { id: id, title: id, short: id, icon: '📁', course: 0, order: 999 };
};
