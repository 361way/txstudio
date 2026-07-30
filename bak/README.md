# 历史归档

本目录不参与当前项目的构建、测试或运行。内容按来源归档：

- `reference/`：`flowith-ui.html`、`dianshang.html`、training docs 等设计与功能参考。
- `docs/`：旧 SaaS/云部署文档、研究材料和已经过时的架构图。
- `legacy-proxy/`：原独立 `proxy-server.go` / `proxy-server.mjs`；功能已整合到主 Go 后端。
- `backend-saas/`：旧登录、多租户、管理员、套餐、配额、独立 COS 资产和模板接口。
- `frontend/`：旧模板库、配额组件、未接入的实验和调试代码。
- `release/`：仍依赖旧独立代理的发布工作流。

如需恢复历史实现，应先重新审视安全边界和当前 SQLite 数据模型，不要直接从本目录导入模块。
