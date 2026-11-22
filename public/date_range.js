(() => {
    'use strict';

    const from = document.getElementById('y-date-from');
    const to = document.getElementById('y-date-to');
    const trigger = document.getElementById('y-range-trigger');
    const panel = document.getElementById('y-range-calendar');
    const grid = document.getElementById('y-calendar-days');
    const title = document.getElementById('y-month-title');
    const hint = document.getElementById('y-range-hint');

    const single = from?.type === 'date';
    if (!from || !trigger || !panel || !grid || !title || (!single && (!to || !hint))) {
        return;
    }

    if (single) {
        from.hidden = true;
        document.querySelector('label[for="y-date-from"]').htmlFor = trigger.id;
        trigger.hidden = false;
    }

    const todayParts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Hong_Kong',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        })
            .formatToParts(new Date())
            .map((part) => [part.type, part.value])
    );

    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    const initialDate = from.value || to?.value || today;

    let [year, month] = initialDate.split('-').map(Number);
    let selectingEnd = Boolean(!single && from.value && !to.value);

    const pad = (number) => String(number).padStart(2, '0');
    const dateString = (day) => `${year}-${pad(month)}-${pad(day)}`;

    function updateText() {
        if (single) {
            trigger.textContent = from.value || 'Select date';
            return;
        }
        if (from.value && to.value) {
            trigger.textContent = `${from.value} to ${to.value}`;
        } else if (from.value) {
            trigger.textContent = `${from.value} to Select end date`;
        } else {
            trigger.textContent = 'Select Date Range';
        }

        hint.textContent = selectingEnd
            ? 'Choose the end date (the same day is allowed)'
            : 'Choose the start date, then the end date';
    }

    function closeCalendar() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    function renderCalendar() {
        title.textContent = new Intl.DateTimeFormat('en-GB', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC'
        }).format(new Date(Date.UTC(year, month - 1, 1)));
        grid.replaceChildren();

        const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();

        const offset = (firstWeekday + 6) % 7;

        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

        for (let i = 0; i < offset; i++) {
            grid.appendChild(document.createElement('span'));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = dateString(day);
            const button = document.createElement('button');

            button.type = 'button';
            button.textContent = day;
            button.className = 'y-calendar-day';

            button.setAttribute('aria-label', date);
            if (single) button.setAttribute('aria-pressed', String(date === from.value));
            if (date === from.value || date === to?.value) {
                button.classList.add('primary');
            } else if (from.value && to?.value && date > from.value && date < to.value) {
                button.classList.add('y-range-middle');
            }

            button.addEventListener('click', () => {
                if (single) {
                    from.value = date;
                    closeCalendar();
                    trigger.focus();
                } else if (!selectingEnd) {
                    from.value = date;
                    to.value = '';
                    selectingEnd = true;
                } else {
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
        const date = new Date(Date.UTC(year, month - 1 + delta, 1));

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

    document
        .getElementById('y-prev-month')
        .addEventListener('click', () => changeMonth(-1));

    document.getElementById('y-next-month').addEventListener('click', () => changeMonth(1));

    document.getElementById('y-range-clear').addEventListener('click', () => {
        from.value = '';
        if (to) to.value = '';
        selectingEnd = false;

        closeCalendar();
        trigger.focus();
        updateText();
        renderCalendar();
    });

    document.getElementById('y-range-done')?.addEventListener('click', () => {
        if (from.value && !to.value) {
            to.value = from.value;
        }

        selectingEnd = false;
        closeCalendar();
        trigger.focus();
        updateText();
        renderCalendar();
    });

    document.addEventListener('keydown', (event) => {
        if (!panel.hidden && event.key === 'Escape') {
            closeCalendar();
            trigger.focus();
        }
    });

    document.addEventListener('click', (event) => {
        if (!panel.hidden && !event.composedPath().includes(panel) && event.target !== trigger) {
            closeCalendar();
        }
    });

    updateText();
    renderCalendar();
})();
