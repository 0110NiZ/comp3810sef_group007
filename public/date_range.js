
(() => {
    'use strict';

    const from = document.getElementById('y-date-from');
    const to = document.getElementById('y-date-to');
    const trigger = document.getElementById('y-range-trigger');
    const panel = document.getElementById('y-range-calendar');
    const grid = document.getElementById('y-calendar-days');
    const title = document.getElementById('y-month-title');
    const hint = document.getElementById('y-range-hint');

    if (!from || !to || !trigger || !panel || !grid || !title || !hint) {
        return;
    }

    const todayParts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date()).map(part => [part.type, part.value])
    );

    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const initialDate = from.value || to.value || today;

    let [year, month] = initialDate.split('-').map(Number);
    let selectingEnd = Boolean(from.value && !to.value);

    const pad = number => String(number).padStart(2, '0');
    const dateString = day => `${year}-${pad(month)}-${pad(day)}`;

    function updateText() {
        if (from.value && to.value) {
            trigger.textContent = `${from.value} 至 ${to.value}`;
        } else if (from.value) {
            trigger.textContent = `${from.value} 至 请选择结束日期`;
        } else {
            trigger.textContent = '选择起止日期';
        }

        hint.textContent = selectingEnd
            ? '请选择结束日期（可与开始日期相同）'
            : '第一次选择开始日期，第二次选择结束日期';
    }

    function closeCalendar() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    function renderCalendar() {
        title.textContent = `${year} 年 ${month} 月`;
        grid.replaceChildren();

        const firstWeekday =
            new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

        const offset = (firstWeekday + 6) % 7;

        const daysInMonth =
            new Date(Date.UTC(year, month, 0)).getUTCDate();

        for (let i = 0; i < offset; i++) {
            grid.appendChild(document.createElement('span'));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = dateString(day);
            const button = document.createElement('button');

            button.type = 'button';
            button.textContent = day;
            button.className = 'y-calendar-day';

            if (date === from.value || date === to.value) {
                button.classList.add('y-range-edge');
            } else if (
                from.value &&
                to.value &&
                date > from.value &&
                date < to.value
            ) {
                button.classList.add('y-range-middle');
            }

            button.addEventListener('click', () => {
                if (!selectingEnd) {
                    // 第一次点击：开始日期
                    from.value = date;
                    to.value = '';
                    selectingEnd = true;
                } else {
                    // 第二次点击：结束日期
                    if (date < from.value) {
                        to.value = from.value;
                        from.value = date;
                    } else {
                        to.value = date;
                    }

                    selectingEnd = false;
                    closeCalendar();
                }

                updateText();
                renderCalendar();
            });

            grid.appendChild(button);
        }
    }

    function changeMonth(delta) {
        const date = new Date(
            Date.UTC(year, month - 1 + delta, 1)
        );

        year = date.getUTCFullYear();
        month = date.getUTCMonth() + 1;

        renderCalendar();
    }

    trigger.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        trigger.setAttribute('aria-expanded', String(!panel.hidden));

        if (!panel.hidden) {
            renderCalendar();
        }
    });

    document.getElementById('y-prev-month')
        .addEventListener('click', () => changeMonth(-1));

    document.getElementById('y-next-month')
        .addEventListener('click', () => changeMonth(1));

    document.getElementById('y-range-clear')
        .addEventListener('click', () => {
            from.value = '';
            to.value = '';
            selectingEnd = false;

            closeCalendar();
            updateText();
            renderCalendar();
        });

    document.getElementById('y-range-done')
        .addEventListener('click', () => {
            if (from.value && !to.value) {
                to.value = from.value;
            }

            selectingEnd = false;
            closeCalendar();
            updateText();
            renderCalendar();
        });

    document.addEventListener('click', event => {
        if (
            !panel.hidden &&
            !panel.contains(event.target) &&
            event.target !== trigger
        ) {
            closeCalendar();
        }
    });

    updateText();
    renderCalendar();
})();
