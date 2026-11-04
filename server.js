const express = require('express');
const mongoose = require('mongoose');

const app = express();

// 使用 EJS 显示网页
app.set('view engine', 'ejs');

// 提供 public 文件夹中的静态资源
app.use(express.static('public'));

// 首页
app.get('/', (req, res) => {
    res.status(200).render('info', {
        message: '流浪动物救助与领养管理系统：服务器启动成功！'
    });
});

// 本机 MongoDB 连接地址及本项目的数据库名称
const mongourl = 'mongodb://127.0.0.1:27017/animal_rescue_group007';

// 沿用课堂示例的默认端口
const port = process.env.PORT || 8099;

// 先连接数据库，再启动网页服务器
async function startServer() {
    try {
        await mongoose.connect(mongourl);

        console.log('MongoDB 连接成功');
        console.log(`当前数据库：${mongoose.connection.name}`);

        app.listen(port, () => {
            console.log(`Listening at http://localhost:${port}`);
        });
    } catch (error) {
        console.error('数据库连接失败：', error.message);
        process.exit(1);
    }
}

startServer();