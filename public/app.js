'use strict';

document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(button.dataset.copy);
            button.textContent = 'Copied';
        } catch {
            button.textContent = 'Select the code to copy';
        }
    });
});

const placement = document.querySelector('[name="placementLocation"]');
const rescueStage = document.querySelector('[name="rescueStatus"]');
if (placement && rescueStage) {
    const mark = document.querySelector('[data-required-mark="placementLocation"]');
    const updateRequirements = () => {
        placement.required = rescueStage.value === 'placed';
        if (mark) mark.hidden = !placement.required;
        placement.setAttribute('aria-required', String(placement.required));
        placement.setCustomValidity('');
    };
    rescueStage.addEventListener('change', updateRequirements);
    updateRequirements();
}

document.querySelectorAll('.phone-controls').forEach((controls) => {
    const select = controls.querySelector('select');
    const input = controls.querySelector('input');
    function updatePhoneFormat() {
        const digits = select.selectedOptions[0].dataset.digits;
        input.pattern = '[0-9]{' + digits + '}';
        input.placeholder = digits + ' digits';
        input.title = 'Enter ' + digits + ' digits for ' + select.value + '.';
    }
    select.addEventListener('change', updatePhoneFormat);
    updatePhoneFormat();
});

// Reject whitespace-only required text before leaving the form.
document
    .querySelectorAll('textarea, input:not([type="hidden"]):not([type="password"])')
    .forEach((field) => {
        const validate = () => {
            field.setCustomValidity(
                field.required && field.value && !field.value.trim()
                    ? 'Please enter a value, not only spaces.'
                    : ''
            );
        };
        field.addEventListener('input', validate);
        field.addEventListener('change', validate);
        validate();
    });

const accountMenu = document.querySelector('.account-menu');
if (accountMenu) {
    document.addEventListener('click', (event) => {
        if (!accountMenu.contains(event.target)) accountMenu.open = false;
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && accountMenu.open) {
            accountMenu.open = false;
            accountMenu.querySelector('summary').focus();
        }
    });
}

const caseNavigation = document.querySelector('.case-navigation');
if (caseNavigation) {
    const links = [...caseNavigation.querySelectorAll('a[href^="#"]')];

    function selectCaseSection() {
        const target = document.getElementById(location.hash.slice(1));
        const selected = links.find(link =>
            document.querySelector(link.hash)?.contains(target)
        ) || links[0];

        for (const link of links) {
            document.querySelector(link.hash).hidden = link !== selected;
            if (link === selected) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
        }
        const adminActions = document.getElementById('record-actions');
        if (adminActions) adminActions.hidden = selected !== links[0];
    }

    selectCaseSection();
    window.addEventListener('hashchange', selectCaseSection);
}
