const digitsByCode = new Map([['+852', 8], ['+86', 11]]);
const phoneHint = 'Enter 8 digits for +852 or 11 digits for +86.';

function phoneParts(value = '') {
    // Older records may have a local number or use spaces, hyphens and parentheses.
    const compact = value.replace(/[ ()-]/g, '');
    for (const [code, digits] of digitsByCode) {
        if (compact.startsWith(code)) return { code, number: compact.slice(code.length) };
        if (/^[0-9]+$/.test(compact) && compact.length === digits)
            return { code, number: compact };
    }
    return { code: '+852', number: value };
}

function normalizePhone(value, code) {
    if (typeof value !== 'string') return null;
    if (code === undefined) {
        // Existing API callers can send one international number or 8/11 local digits.
        if (value === '') return '';
        if (!/^\+?[0-9]+$/.test(value)) return null;
        const parts = phoneParts(value);
        if (!parts.number) return null;
        value = parts.number;
        code = parts.code;
    }
    if (!digitsByCode.has(code)) return null;
    if (value === '') return '';
    if (!/^[0-9]+$/.test(value) || value.length !== digitsByCode.get(code)) return null;
    return code + value;
}

module.exports = { digitsByCode, phoneHint, phoneParts, normalizePhone };
