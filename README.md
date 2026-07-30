# 校园访客审批平台

这是根据 `校园访客审批.docx` 说明开发的本地版校园访客系统，支持申请人免登录提交访客申请、二维码查询、保卫负责人审批、管理员维护基础数据，以及门卫大屏核验。

## 功能

- 公开访客申请：选择部门，填写申请人、访客、车牌、事由、入校时间段。
- 自动生成二维码：提交后生成专属二维码，可供访客或门卫扫码查看审批状态。
- 保卫审批：保卫账号登录后可通过或打回申请，记录审批人和审批时间。
- 管理端：管理员可维护部门、审批账号，并查看/删除申请。
- 大屏展示：展示当前时间以后仍有效、且已审批通过的访客信息。

## 技术栈

- Node.js
- Express
- EJS
- MySQL

## 本地运行

1. 确保本机 MySQL 已启动，连接信息为：

   - 地址：`localhost`
   - 端口：`3306`
   - 用户名：`root`
   - 密码：`root`

2. 安装依赖：

   ```bash
   pnpm install
   ```

3. 启动系统：

   ```bash
   pnpm start
   ```

4. 浏览器访问：

   - 申请入口：http://localhost:3000/
   - 登录入口：http://localhost:3000/login
   - 大屏页面：http://localhost:3000/screen

首次启动会自动创建数据库、数据表、默认部门和默认账号。

也可以检查数据库是否就绪：

```bash
pnpm check:db
```

## 一键启动和停止

Windows 下可直接双击：

- `启动网站.bat`
- `停止网站.bat`

启动脚本会检查 MySQL `localhost:3306`，如果未运行，会尝试启动常见的 MySQL 服务名，例如 `MySQL80`、`MySQL`、`MariaDB`。随后会启动网站并写入进程文件。

停止脚本只停止本项目的网站进程，不会关闭 MySQL，避免影响本机其他系统。

运行日志位于：

```text
logs/app.out.log
logs/app.err.log
```

## 默认账号

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 管理员 | admin | admin123 |
| 保卫审批 | security | security123 |

上线前请登录后及时修改或删除默认账号。

## 目录结构

```text
src/server.js        后端服务入口
views/               页面模板
public/css/style.css 页面样式
sql/schema.sql       数据库结构参考
```
