# L 模块安装与验收指南

本包把动物新增、详情、基本资料编辑接入真实 MongoDB，并复用上传的 T 分支认证和 CSRF。必须先将 T 分支合入个人 L 分支，再应用补丁。M/N 的救助、领养流程和 Y 的列表统计仍须另外联调。

## 1 安装

在 Ubuntu 终端执行。网页若仍运行，先 Ctrl+C。

```bash
cd ~/comp3810sef_group007
git branch --show-current
git status
```

必须是 feature/l-animal，且工作区干净。如果不一致，停止并发出输出。

```bash
git merge --ff-only origin/feature/t-auth
```

这会把已下载的 T 分支认证代码快进到个人 L 分支，不会推送或修改 main。此处刻意不额外 fetch，以使用打包时已经取得的 T 版本。如果无法快进，停止，不用强制覆盖。

把下载的 group007-l-module-v1.tar.gz 复制到 /home/lky。可以在 Ubuntu 执行 cd ~，再 explorer.exe . 打开该目录，粘贴文件。

```bash
tar -xzf ~/group007-l-module-v1.tar.gz -C ~
python3 ~/group007-l-module-v1/apply_l_module.py
```

应用器校验 L 分支、干净工作区及 T 版本文件指纹；校验通过后，把将修改的旧文件备份到主目录中带时间的 group007-l-backup 文件夹，再应用 L 文件。若校验拒绝，保留输出，不手工整份覆盖 server.js。包中没有 node_modules、密码、数据库或依赖升级。

```bash
cd ~/comp3810sef_group007
node --check server.js
node --check test-l-animal.js
git diff --stat
```

现有 npm ci 已安装的依赖可以直接使用；package.json 和 package-lock.json 没有改动。

## 2 在本机 MongoDB 8 上运行集成测试

```bash
sudo docker start group007-mongo
cd ~/comp3810sef_group007
node test-l-animal.js
```

测试自行启动临时 HTTP 端口，真实调用 T 的登录和 Cookie/CSRF，不需要提前 npm start。默认只连接 mongodb://127.0.0.1:27017/group007_l_test。只允许数据库名 group007_l_test，不使用业务库，不 dropDatabase；finally 删除本次创建的数据。中断进程可能留下该次测试资料，但不会影响业务库。

预期 27 组检查通过。测试覆盖未登录、CSRF、真实登录、新增、详情、错误 ID、输入类型与长度、字段越权、基本编辑、保留 M/N 字段、旧版本与并发编辑、网页 303、重复参数、关联记录隔离与 HTML 转义、结案后拒绝编辑、并发新增编号、唯一索引和退出。

验证范围：开发环境已用真实 MongoDB 7.0.14 跑通同一测试；这里的 MongoDB 8.0.12 临时实例因 CPU 信息读取限制无法启动，所以本机 MongoDB 8 测试结果仍须实际执行确认。没有把未执行的本机测试或浏览器检查宣称为已通过。

## 3 初始化一个虚构工作人员账号

只供本机开发；用户名固定为 l_demo_staff，角色 staff。不会覆盖同名已有用户，不会清空数据库，不会在 npm start 时自动创建账号。密码使用 T 的 scrypt 哈希函数。

```bash
cd ~/comp3810sef_group007
read -r -s -p '为 l_demo_staff 设置密码（8–128 字符）：' L_DEMO_PASSWORD
printf '\n'
printf '%s' "$L_DEMO_PASSWORD" | node server.js --l-create-test-user
unset L_DEMO_PASSWORD
```

输入密码时没有字符显示是正常现象。成功显示账号创建信息；密码由自己设置，不发送给助手或组员。若提示用户已存在且未覆盖，使用之前设置的密码。

## 4 启动和浏览器验收

```bash
CONNECT_DB=1 npm start
```

打开 http://localhost:8099/login，使用 l_demo_staff 和自己设置的密码。

登录后首页仍是 Y 的示例页面。直接打开 http://localhost:8099/animals/new 测试 L 功能。

1. 新增：类型选猫，发现地点填校园东门，外观填橘白小猫，健康填待检查，联系人填测试联系人，电话填 00000000。点击登记动物。
2. 预期：跳到带真实 ObjectId 的详情地址；编号以 A007- 开头；救助为待救助、领养为未开放、登记人为 L 本机测试工作人员。复制此详情地址。
3. 刷新：资料仍在；关闭页面后再次打开复制的地址，仍可读到记录。
4. 编辑：点击编辑基本资料，修改健康状况为已完成检查，保存后回到详情。其他基本字段、编号和业务状态保持正确。
5. 旧页面：同时打开两个编辑标签页。在第一个保存后，再在第二个保存，应返回冲突信息；返回详情重新打开编辑页后再改。
6. 输入错误：浏览器必填检查正常；绕过前端的非法输入、字段注入和结案保护由集成测试覆盖。
7. 权限：退出后重新打开复制的详情地址，应跳转登录；使用浏览器后退缓存不代表服务器仍允许读取，刷新或重新请求验证。

当前 Y 的首页和列表仍展示示例，所以新动物暂时不会自动出现在列表中；示例动物链接访问真实详情可能返回 404。这是尚未合并 Y 的真实查询代码导致，不能当作新增数据丢失。用新增成功后复制的真实地址验证。

M/N 未合并时，救助管理/领养管理入口仍指向原型路由；本包不声称这些流程可用。

## 5 API 约定与 curl 示例

POST /api/animals 创建；GET /api/animals/:id 读取基本档案；PUT /api/animals/:id 更新六个基本字段。均需要真实登录，写入还需要 CSRF。API GET 返回动物数据本身；网页详情另外查询跟进与领养资料。

创建和编辑六个字段为 animalType、appearance、foundLocation、healthStatus、contactName、contactPhone。PUT 使用完整六字段，允许额外 expectedUpdatedAt（从 GET 的 updatedAt 原样取得），用于检测客户端的旧版本。网页必须提交隐藏的版本字段。_csrf 允许通过表单提交，API 推荐 x-csrf-token 请求头。其他字段被拒绝，不能提交 createdBy、animalCode 或救助/领养/结案状态。

下面命令在另一个 Ubuntu 终端执行，保持网站运行。Cookie 只放临时文件，不提交 Git。

```bash
L_COOKIE_FILE=$(mktemp)
L_CSRF=$(curl -fsS -c "$L_COOKIE_FILE" http://localhost:8099/api/csrf | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.csrfToken')
read -r -s -p '输入 l_demo_staff 密码：' L_DEMO_PASSWORD
printf '\n'
curl -sS -b "$L_COOKIE_FILE" -c "$L_COOKIE_FILE" -H "x-csrf-token: $L_CSRF" --data-urlencode username=l_demo_staff --data-urlencode "password=$L_DEMO_PASSWORD" http://localhost:8099/api/login
unset L_DEMO_PASSWORD
L_CSRF=$(curl -fsS -b "$L_COOKIE_FILE" -c "$L_COOKIE_FILE" http://localhost:8099/api/csrf | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.csrfToken')
```

登录响应必须 success:true；登录会更换 Token，所以必须重新获取。

```bash
curl -i -b "$L_COOKIE_FILE" -H "x-csrf-token: $L_CSRF" -H 'Content-Type: application/json' -d '{"animalType":"cat","appearance":"API测试小猫","foundLocation":"校园东门","healthStatus":"待检查","contactName":"测试联系人","contactPhone":"00000000"}' http://localhost:8099/api/animals
```

预期 201。把响应 data._id 填到下一行：

```bash
L_ANIMAL_ID='替换为刚返回的24位_id'
curl -i -b "$L_COOKIE_FILE" "http://localhost:8099/api/animals/$L_ANIMAL_ID"
curl -i -X PUT -b "$L_COOKIE_FILE" -H "x-csrf-token: $L_CSRF" -H 'Content-Type: application/json' -d '{"animalType":"cat","appearance":"API测试小猫","foundLocation":"校园东门","healthStatus":"已完成检查","contactName":"测试联系人","contactPhone":"00000000"}' "http://localhost:8099/api/animals/$L_ANIMAL_ID"
rm -f "$L_COOKIE_FILE"
unset L_COOKIE_FILE L_CSRF L_ANIMAL_ID
```

L 没有 DELETE 动物接口，删除属于 N，不另外重复实现。

## 6 提交和后续联调

完成本机测试和浏览器验证后，再提交。先检查差异，不把压缩包或 node_modules 放进仓库：

```bash
git diff --check
git diff --stat
git status
git add server.js views/create.ejs views/edit.ejs views/details.ejs README.md test-l-animal.js L_MODULE_GUIDE.md
git commit -m "Implement authenticated animal creation details and basic editing"
git push origin feature/l-animal
```

首次提交前如 Git 要求 user.name/user.email，填写自己的 GitHub 署名；如推送要求认证，按实际提示处理，不粘贴密码或 Token。

与 Y 验证新增后的列表、统计、详情；与 M 验证负责人、安置地点和跟进记录；与 N 验证领养资料和结案只读。N 新增的取消/重新登记涉及旧指南之外的新字段，需读取 N 最新模型后再补充取消状态、原因等展示。目前详情读取当前模型允许的所有关联领养记录，但不声称已完成 N 的取消历史联调。共享样式、模型、公共 form-actions 和其他模块路由均未修改。
