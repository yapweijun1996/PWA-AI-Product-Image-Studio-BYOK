# 中文快速开始（Singapore / Malaysia）

这份文档是 **PWA-AI-Product-Image-Studio-BYOK 的设计基线**。`app/` 已支持本地 SKU、用户确认事实和保留原件的图片上传，并有离线外壳缓存；图片生成、备份和完整 PWA 仍未完成，请以任务账本和实际验证为准。

## 目标

用户上传一个真实商品（SKU）的照片，使用自己的 OpenAI API Key（BYOK），生成 **Studio / Hero / Lifestyle / Flat Lay / Macro / UGC / Billboard** 七种可选电商视觉风格。商品 Logo、中文标签、形状、型号和颜色是事实约束；不允许为了漂亮而偷偷修改真实商品。

**最重要区别：** Prompt 不能保证像素级不变。STRICT 模式保留原始产品前景像素，AI 优先生成场景和背景，再利用浏览器合成；BALANCED 属于更自由但不保证精确的一般图片编辑；CREATIVE 必须标记为 Concept。

## 先读哪些文件

- **做 Product / Scope：** `docs/01-product/PRD.md`、`docs/01-product/FEATURE_PRIORITY.md`
- **做 React/PWA：** `docs/02-architecture/SYSTEM_ARCHITECTURE.md`、`docs/02-architecture/PWA_OFFLINE.md`
- **做 BYOK 安全：** `docs/03-security/BYOK_SECURITY.md`、`docs/03-security/THREAT_MODEL.md`
- **做 OpenAI API：** `docs/05-api/OPENAI_ADAPTER.md`、`contracts/openapi.yaml`
- **做七张商品图片：** `docs/06-ai/BRAND_LOCK_ENGINE.md`、`docs/06-ai/SEVEN_STYLE_ENGINE.md`、`contracts/style-presets.json`
- **做 QA / E2E：** `docs/06-ai/VISUAL_QA.md`、`docs/07-quality/E2E_ACCEPTANCE.md`
- **交给 OMP / Pi / Agent：** `AGENTS.md`、`docs/08-delivery/AI_AGENT_HANDOFF.md`、`docs/08-delivery/TASK.md`

## 建议执行顺序

1. 核对 GitHub 仓库 HEAD、项目规约、现有代码与 `docs/08-delivery/TASK.md` 的最新证据。
2. 按 `DECISION_REGISTER.md` 审核尚未批准的部署、登录和密钥存储选择。
3. 先完成 PWA、数据结构、BYOK Gateway，再完成单 Style 端到端调用。
4. 落实 STRICT 前景像素保护、Mask、QA 和人工批准，最后再加七风格批量。
5. 跑 Unit、Integration、Playwright、iOS 真机、Security、真实商品 Pilot；实测通过后才可以标 DONE。

## 安全警告

正式公开站点 **不要在浏览器 localStorage、IndexedDB、Service Worker 或 URL 保存 API Key**。使用 HTTPS + 受信任的后端临时会话（加密服务端密钥）或用户自托管代理；采用限流、认证、审计和明确清除机制。不要把 Key 写入 GitHub。

## 文档包验证

```bash
python3 scripts/validate_ssot.py
```

该命令检查内部相对链接、JSON、关键文档、Schema、OpenAPI 结构、七个唯一风格 ID、文件清单的 Hash、文档完整性等。它**不能**替代代码测试、真实 API 调用、实际图片视觉 QA。
