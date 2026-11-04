// 原型表单只在浏览器展示反馈，不请求服务器，不保存到本地存储。
document.querySelectorAll('form[data-preview]').forEach(form => {
    form.addEventListener('submit', event => {
        event.preventDefault();
        const feedback = form.querySelector('.form-feedback');
        const password = form.elements.namedItem('newPassword');
        const confirmation = form.elements.namedItem('confirmPassword');
        if (password && confirmation && password.value !== confirmation.value) {
            feedback.textContent = '两次新密码不一致，请重新输入。';
            feedback.hidden = false;
            return;
        }
        feedback.textContent = form.dataset.preview + '：表单预览已完成，未验证权限或业务状态，也未保存任何数据。';
        feedback.hidden = false;
        if (form.dataset.sensitive) form.querySelectorAll('input[type="password"]').forEach(input => input.value = '');
        feedback.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    });
});
