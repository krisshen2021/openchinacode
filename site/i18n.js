/* ═══════════════════════════════════════════════════════════
   OpenChinaCode — Bilingual i18n (EN / ZH)
   data-i18n       → textContent
   data-i18n-html  → innerHTML
   data-i18n-title → title attribute
   data-i18n-meta  → content attribute (meta tags)
   ═══════════════════════════════════════════════════════════ */

const I18N = {
  en: {
    /* ── Meta ── */
    "meta.home.desc": "A China-model focused terminal coding agent for GLM, Kimi, and DeepSeek.",
    "meta.home.ogDesc": "A fast, model-routed coding agent for GLM, Kimi, and DeepSeek.",
    "meta.manual.title": "OpenChinaCode Manual",
    "meta.manual.desc": "OpenChinaCode usage and configuration manual for GLM, Kimi, DeepSeek, task routing, compaction, LSP, and Playwright MCP.",
    "meta.manual.ogDesc": "Usage and configuration guide for the China-model focused coding agent.",

    /* ── Lang toggle ── */
    "lang.toggle": "中文",
    "lang.toggleTitle": "Switch language",

    /* ── Nav ── */
    "nav.providers": "Providers",
    "nav.features": "Features",
    "nav.manual": "Manual",
    "nav.quickStart": "Quick Start",

    /* ── Hero ── */
    "hero.eyebrow": "GLM · KIMI · DEEPSEEK CODING AGENT",
    "hero.lead": "A lean terminal coding agent forked from opencode and rebuilt around China-focused model routing, smart compaction, sliding output budgets, RMB cost tracking, LSP diagnostics, and Playwright browser testing.",
    "hero.install": "Install now",
    "hero.copied": "Copied!",
    "hero.readManual": "Read manual",
    "hero.release": "Latest release",
    "hero.copy": "Copy command",
    "hero.block.install": "install",
    "hero.block.upgrade": "upgrade",

    /* ── Capability strip ── */
    "cap.routing.title": "Task routing",
    "cap.routing.desc": "Dual-layer routing: base subagent routes plus optional extra LLM dispatch.",
    "cap.compaction.title": "Smart compaction",
    "cap.compaction.desc": "Profile judge + active-task extraction + raw recent tail.",
    "cap.budgets.title": "Output budgets",
    "cap.budgets.desc": "Model-aware max tokens with overflow-safe triggers.",
    "cap.vision.title": "Enhance Vision",
    "cap.vision.desc": "Paste any image and any model can see it — vision for all.",

    /* ── Stats ── */
    "stats.providers": "Provider families",
    "stats.routes": "Task route types",
    "stats.layers": "Compaction layers",
    "stats.rmb": "RMB cost tracking",

    /* ── Providers section ── */
    "providers.eyebrow": "MODEL ROUTING",
    "providers.title": "Built for China-model coding work,<br>not just connected to China models.",
    "providers.lead": "OpenChinaCode keeps the terminal-first opencode workflow, then narrows the default model surface to GLM, Kimi, and DeepSeek with model-aware request transforms, task routing, compaction, testing, and RMB cost display.",
    "providers.glm.tag": "PLAN",
    "providers.glm.title": "GLM-led reasoning",
    "providers.glm.desc": "Architecture, complex planning, and heavy refactors favor GLM-5.2 variants for deep reasoning.",
    "providers.kimi.tag": "BUILD",
    "providers.kimi.title": "Kimi for speed",
    "providers.kimi.desc": "Quick review, implement, explore, summarize, and compaction subagents use fast Kimi K3 routes when the task fits.",
    "providers.deepseek.tag": "DEBUG",
    "providers.deepseek.title": "DeepSeek for loops",
    "providers.deepseek.desc": "Debug and test-fix loops are tuned for DeepSeek, with sliding max-token behavior.",

    /* ── Features section ── */
    "features.eyebrow": "CAPABILITIES",
    "features.title": "Everything you need,<br>nothing you don't.",
    "features.routing.title": "Intelligent subagent routing",
    "features.routing.desc": "Plan, architecture, refactor, review, implement, explore, debug, test_fix, summarize, compaction, and visual_check each have quick/medium/complex routes.",
    "features.compaction.title": "Smart compaction pipeline",
    "features.compaction.desc": "Manual or automatic compaction keeps a general summary, extracts the active task at higher granularity, and can retain raw recent turns with <code>/compact keep N</code>.",
    "features.budgets.title": "Model-aware token budgets",
    "features.budgets.desc": "<code>/auto-maxtokens</code> uses official model windows, task signals, and overflow checks so complex coding turns can request large outputs without needless compression.",
    "features.tuning.title": "China-provider tuning",
    "features.tuning.desc": "GLM, Kimi, and DeepSeek use direct official OpenAI-compatible APIs with provider-specific max-token, reasoning, sampling, and tool-call behavior.",
    "features.browser.title": "Browser testing workflow",
    "features.browser.desc": "<code>/test-mcp</code>, <code>/browser-check</code>, and <code>/integration-test</code> wire Playwright MCP and test reports into the agent workflow.",
    "features.costs.title": "Visible costs & diagnostics",
    "features.costs.desc": "The TUI shows RMB cost, model-aware context usage, route details, LSP diagnostics, and compaction debug stages so behavior is inspectable.",

    /* ── Media highlight ── */
    "media.eyebrow": "NATIVE MEDIA GENERATION",
    "media.title": "Generate images and videos<br>without leaving the terminal.",
    "media.desc": "Ask in natural language or use slash commands. OpenChinaCode routes image and video generation through Volcengine Ark with automatic download to local files.",
    "media.image.tag": "IMAGE",
    "media.image.title": "ByteDance Seedream 5.0 Pro",
    "media.image.desc": "Up to 2K resolution, multiple aspect ratios, reference-image support, and PNG/JPEG output.",
    "media.image.cmd": "/image-generate a cyberpunk cat mascot",
    "media.video.tag": "VIDEO",
    "media.video.title": "ByteDance Seedance 2.0 Mini",
    "media.video.desc": "4 to 15 second clips, 720p, first/last frame control, reference images, and generated audio.",
    "media.video.cmd": "/video-generate a 5s product promo clip",
    "media.nl.title": "Natural language or slash command",
    "media.nl.desc": "Just describe what you want, or run <code>/image-generate</code> and <code>/video-generate</code> with an optional prompt. Missing details trigger follow-up questions, not guesses.",

    /* ── Updates strip ── */
    "updates.label": "Recent updates",
    "updates.tag.musttry": "MUST TRY",
    "updates.tag.new": "NEW",
    "updates.tag.enhance": "ENHANCE",
    "updates.1": "Project permission policy panel — Trust All, Safe, Readonly, or Ask Everything per project",
    "updates.2": "Extra task router — auto-dispatch subtasks via fast LLM judge",
    "updates.3": "Session picker — arrow keys to switch current / all projects",
    "updates.4": "Native image & video generation via Volcengine Ark",
    "updates.5": "Paste-image visual preprocessing with GLM-5V for all models",
    "updates.6": "Dual-layer routing — base routes plus optional extra dispatch",
    "updates.7": "Soul persona selection — rigorous, friendly, or custom per project",
    "updates.8": "Baidu Unlimited-OCR — native document parsing for PDF, DOC, PPT, and images",

    /* ── OCR hero ── */
    "ocr.eyebrow": "NATIVE OCR & DOCUMENT PARSING",
    "ocr.hero.title": "Parse PDFs, docs, and images<br>into Markdown without leaving the terminal.",
    "ocr.hero.desc": "Powered by Baidu Unlimited-OCR. Paste a document or image, get structured Markdown and JSON back. No local GPU required.",
    "ocr.hero.cta": "Read the manual",

    /* ── OCR manual section ── */
    "ocr.section.title": "Native OCR & Document Parsing",
    "ocr.section.desc": "OpenChinaCode integrates Baidu Unlimited-OCR for cloud-native document parsing. Submit PDFs, Office docs, or images and get structured Markdown and JSON back — no local GPU or inference environment required.",
    "ocr.auth.tag": "Auth",
    "ocr.auth.title": "Baidu Unlimited-OCR credentials",
    "ocr.auth.desc": "Run <code>/ocr-auth</code> in the TUI, or set <code>BAIDU_OCR_API_KEY</code> and <code>BAIDU_OCR_SECRET_KEY</code> environment variables. Keys are stored in <code>~/.local/share/openchinacode/auth.json</code> under provider <code>baidu-unlimited-ocr</code>.",
    "ocr.formats.tag": "Formats",
    "ocr.formats.title": "Supported file types",
    "ocr.formats.desc": "Documents: <code>pdf</code>, <code>ofd</code>, <code>doc</code>, <code>docx</code>, <code>txt</code>, <code>wps</code>, <code>ppt</code>, <code>pptx</code>. Images: <code>jpg</code>, <code>jpeg</code>, <code>png</code>, <code>bmp</code>, <code>tif</code>, <code>tiff</code>. Output saved to <code>/tmp/openchinacode/ocr</code> as Markdown + JSON + metadata.",
    "ocr.nl.tag": "Trigger",
    "ocr.nl.title": "Paste or slash command",
    "ocr.nl.desc": "Run <code>/ocr</code> with optional file paths, or <code>Ctrl+V</code> paste a document into the TUI. Document files always route to OCR; images only route to OCR when you explicitly ask to extract text, parse tables, or convert to Markdown. Regular screenshots and UI images still go to the visual model.",

    /* ── CTA ── */
    "cta.title": "Need the exact commands and config files?",
    "cta.desc": "The manual documents slash commands, provider auth, task policy overrides, smart compaction, LSP, Playwright MCP, and debugging logs.",
    "cta.button": "Open the manual",

    /* ── Footer ── */
    "footer.text": "OpenChinaCode is an independent fork built with respect for the opencode project.",
    "footer.manual": "Manual",
    "footer.home": "Home",
    "footer.install": "Install",
    "footer.releases": "Releases",

    /* ── Manual hero ── */
    "manual.eyebrow": "USAGE & CONFIGURATION GUIDE",
    "manual.lead": "This page covers the OpenChinaCode-specific workflow: GLM/Kimi/DeepSeek provider setup, custom slash commands, task policy routing, smart compaction, LSP diagnostics, and Playwright testing.",
    "manual.titleSuffix": "Manual",

    /* ── TOC ── */
    "toc.quickstart": "Quick Start",
    "toc.config": "Configuration",
    "toc.commands": "Slash Commands",
    "toc.routing": "Task Routing",
    "toc.compaction": "Compaction",
    "toc.testing": "LSP & Testing",
    "toc.debugging": "Debugging",
    "toc.sessions": "Sessions",

    /* ── Quick Start ── */
    "qs.title": "Quick Start",
    "qs.desc": "OpenChinaCode installs as a separate command, so it can coexist with upstream opencode.",
    "qs.install.tag": "Install",
    "qs.install.title": "Install the binary",
    "qs.auth.tag": "Auth",
    "qs.auth.title": "Add provider credentials",
    "qs.run.tag": "Run",
    "qs.run.title": "Start in a project",

    /* ── Configuration ── */
    "config.title": "Configuration Files",
    "config.desc": "OpenChinaCode uses independent config and data paths. Do not put API keys in the repository.",
    "config.global.tag": "Global",
    "config.global.title": "User config",
    "config.global.desc": "Use this for personal defaults: model, task policy overrides, LSP, compaction, and MCP.",
    "config.auth.tag": "Auth",
    "config.auth.title": "Local credentials",
    "config.auth.desc": "Written by <code>openchinacode providers login</code>. File mode is restricted when written by the CLI.",
    "config.project.tag": "Project",
    "config.project.title": "Project overrides",
    "config.project.desc": "Use this when one codebase needs a different task policy or testing setup.",
    "config.authShape": "Auth file shape",
    "config.providerIds": "Main provider IDs",
    "config.table.provider": "Provider",
    "config.table.purpose": "Purpose",
    "config.table.protocol": "Protocol",
    "config.table.notes": "Notes",
    "config.glm.purpose": "GLM / BigModel pay-as-you-go",
    "config.glm.notes": "Base URL is fixed to <code>https://open.bigmodel.cn/api/paas/v4</code>.",
    "config.kimi.purpose": "Kimi / Moonshot China",
    "config.kimi.notes": "Used for fast implementation, review, summarize, and quick routes.",
    "config.deepseek.purpose": "DeepSeek official API",
    "config.deepseek.notes": "Used for debug/test-fix loops and low-cost judge paths.",

    /* ── Slash Commands ── */
    "commands.title": "Custom Slash Commands",
    "commands.desc": "OpenChinaCode-specific commands are grouped under <code>OpenChinaCode</code> in the TUI command palette.",
    "commands.table.command": "Command",
    "commands.table.usage": "Usage",
    "commands.table.effect": "Effect",
    "commands.maxtokens.effect": "Controls sliding output-token budgeting. Heuristic is the recommended daily mode; LLM mode uses a low-cost judge for ambiguous turns.",
    "commands.compact.effect": "Runs smart compaction. <code>keep N</code> also preserves the latest N raw user turns and follow-up assistant/tool messages.",
    "commands.lsp.effect": "Enables language-server diagnostics so the model can see and fix type, syntax, and reference errors.",
    "commands.taskpolicy.effect": "Opens the local TUI task-route table. <code>on</code>/<code>off</code> hot-toggles the entire task policy and task subagent entry; <code>extra-on</code>/<code>extra-off</code> toggles the extra task router; <code>extra-status</code> shows current state. Does not call the model or inject the table into conversation.",
    "commands.soul.effect": "Selects the conversation persona. <code>custom</code> saves to <code>.openchinacode/souls/custom.md</code> and writes <code>soul.active</code> + <code>soul.custom_path</code> to project config. Refreshes the instance for new turns. Does not call the model.",
    "commands.taskclassify.effect": "Asks the current model to explain task kind, complexity, route, and classification signals.",
    "commands.testmcp.effect": "Writes Playwright MCP config and hot-connects or disconnects it from inside the TUI.",
    "commands.browsercheck.effect": "Prompts the agent to run browser-level checks, preferably through Playwright MCP.",
    "commands.integrationtest.effect": "Prompts the agent to use the OpenChinaCode integration-test workflow: run, inspect report, define bug, fix, rerun.",
    "commands.mediaauth.effect": "Saves the Volcengine Ark API key for native image and video generation.",
    "commands.imagegen.effect": "Opens the ByteDance Seedream 5.0 Pro image generation wizard with optional inline prompt.",
    "commands.videogen.effect": "Opens the ByteDance Seedance 2.0 Mini video generation wizard with optional inline prompt.",
    "commands.ocrauth.effect": "Saves Baidu Unlimited-OCR API Key and Secret Key for <code>ocr_extract</code>. Stored in <code>~/.local/share/openchinacode/auth.json</code> under provider <code>baidu-unlimited-ocr</code>. Env fallback: <code>BAIDU_OCR_API_KEY</code> + <code>BAIDU_OCR_SECRET_KEY</code>.",
    "commands.ocr.effect": "Opens the Baidu Unlimited-OCR document parsing wizard. Supports PDF, OFD, DOC, DOCX, TXT, WPS, PPT, PPTX, and image formats. Results saved to <code>/tmp/openchinacode/ocr</code> as Markdown + JSON + metadata.",
    "commands.sessions.effect": "Opens the session picker. Use arrow keys to switch between current-project and all-project sessions.",
    "commands.permissions.effect": "Opens the project permission policy panel. Choose Trust All, Safe, Ask Everything, Readonly, or Reset. Writes to <code>./.openchinacode/openchinacode.jsonc</code> and applies a runtime override immediately.",

    /* ── Task Routing ── */
    "routing.title": "Task Routing Policy",
    "routing.desc": "Subagents are routed by task kind and complexity. General tasks inherit the parent model; specialized tasks use opinionated GLM/Kimi/DeepSeek defaults.",
    "routing.table.kind": "Task kind",
    "routing.table.quick": "Quick",
    "routing.table.medium": "Medium",
    "routing.table.complex": "Complex",
    "routing.override": "Override example",
    "routing.overrideDesc": "Put this in <code>~/.config/openchinacode/openchinacode.jsonc</code> or in a project-level OpenChinaCode config.",

    /* ── Extra Task Router ── */
    "routing.extra.title": "Extra Task Router",
    "routing.extra.desc": "When enabled, ordinary prompts pass through a fast LLM judge that can automatically insert a routed subtask — no explicit <code>/task</code> call needed. Disabled by default.",
    "routing.extra.base.tag": "Base",
    "routing.extra.base.title": "System-level base routing",
    "routing.extra.base.desc": "Explicit task/subagent calls trigger the built-in route table — GLM for planning, Kimi for speed, DeepSeek for debug.",
    "routing.extra.smart.tag": "Extra",
    "routing.extra.smart.title": "Extra smart dispatch",
    "routing.extra.smart.desc": "A fast judge (DeepSeek V4 Flash) inspects each ordinary prompt and inserts a subtask with task_kind + complexity when delegation is appropriate.",
    "routing.extra.control.tag": "Control",
    "routing.extra.control.title": "Toggle and configure",
    "routing.extra.control.desc": "Use <code>/task-policy extra-on</code> / <code>extra-off</code> / <code>extra-status</code>, or set <code>task_policy.extra_router.enabled</code> in config.",
    "routing.extra.config": "{\n  \"task_policy\": {\n    \"extra_router\": {\n      \"enabled\": true,\n      \"confidence_threshold\": 0.7,\n      \"allow\": [\"plan\", \"refactor\", \"review\", \"debug\", \"test_fix\"],\n      \"deny\": [\"general\", \"summarize\", \"compaction\"]\n    }\n  }\n}",

    /* ── Compaction ── */
    "compaction.title": "Smart Compaction",
    "compaction.desc": "OpenChinaCode compaction is routed through task policy and defaults to <code>moonshotai-cn/kimi-k3#high</code>. It uses three layers: general summary, active-task extraction, and minimal raw recent tail.",
    "compaction.strategy.tag": "Strategy",
    "compaction.strategy.title": "Profile-aware summary",
    "compaction.strategy.desc": "A judge model first emits a stable JSON profile, then OpenChinaCode builds a fixed Markdown compaction prompt from that profile.",
    "compaction.recent.tag": "Recent",
    "compaction.recent.title": "Active task extraction",
    "compaction.recent.desc": "The recent active task is extracted at higher granularity than the general summary, so long debugging or refactor context survives.",
    "compaction.manual.tag": "Manual",
    "compaction.manual.title": "Raw tail retention",
    "compaction.manual.desc": "<code>/compact keep N</code> asks OpenChinaCode to keep the latest N raw user turns and their following assistant/tool messages.",

    /* ── LSP & Testing ── */
    "testing.title": "LSP and Browser Testing",
    "testing.lsp.tag": "LSP",
    "testing.lsp.title": "Diagnostics in coding turns",
    "testing.lsp.desc": "Use <code>/lsp on</code>. When enabled, language-server diagnostics can be fed into the model during code edits.",
    "testing.mcp.tag": "MCP",
    "testing.mcp.title": "Playwright from the TUI",
    "testing.mcp.desc": "Use <code>/test-mcp on</code>. This writes Playwright MCP config and hot-connects it without leaving OpenChinaCode.",
    "testing.vision.tag": "Vision",
    "testing.vision.title": "Screenshot interpretation",
    "testing.vision.desc": "Visual checks route to <code>zhipuai-pay2go/glm-5v-turbo</code>. Animation checks should prefer DOM/CSS telemetry and pixel diffs.",

    /* ── Debugging ── */
    "debugging.title": "Debugging and Observability",
    "debugging.desc": "Subagent rows in the TUI show the selected provider, model, variant, task classification, and route source.",
    "debugging.route.tag": "Route",
    "debugging.route.title": "Subagent route logs",
    "debugging.compact.tag": "Compact",
    "debugging.compact.title": "Compaction profile logs",
    "debugging.test.tag": "Test",
    "debugging.test.title": "Integration report",

    /* ── Session Management ── */
    "sessions.title": "Session Management",
    "sessions.desc": "Open the session picker with <code>/sessions</code> (aliases <code>/resume</code>, <code>/continue</code>). Use arrow keys to switch scope.",
    "sessions.scope.tag": "Scope",
    "sessions.scope.title": "Arrow-key scope switch",
    "sessions.scope.desc": "Press <code>←</code> / <code>→</code> to toggle between <strong>Current Project</strong> (with pin/unpin) and <strong>All Projects</strong> (global session list).",
    "sessions.cross.tag": "Cross-project",
    "sessions.cross.title": "Cross-project fork",
    "sessions.cross.desc": "Selecting another project's session offers: open the original project, or fork the session into the current directory.",
    "sessions.manage.tag": "Manage",
    "sessions.manage.title": "Delete and rename",
    "sessions.manage.desc": "Delete (with confirmation) and rename are available for any session in either scope.",

    /* ── Media Generation ── */
    "toc.media": "Media Generation",
    "toc.ocr": "OCR & Documents",
    "media.manual.title": "Native Media Generation",
    "media.manual.desc": "OpenChinaCode can generate images and videos through Volcengine Ark, powered by ByteDance Seedream 5.0 Pro and Seedance 2.0 Mini.",
    "media.auth.tag": "Auth",
    "media.auth.title": "Volcengine Ark credentials",
    "media.auth.desc": "Run <code>/media-auth</code> in the TUI, or set the <code>ARK_API_KEY</code> environment variable. The key is stored in <code>~/.local/share/openchinacode/auth.json</code> under provider <code>volcengine-ark</code>.",
    "media.image.tag": "Image",
    "media.image.manual.title": "ByteDance Seedream 5.0 Pro",
    "media.image.manual.desc": "Up to 2K resolution, 1:1 to 21:9 aspect ratios, up to 10 reference images (local paths, URLs, or data URIs), PNG or JPEG output.",
    "media.image.cmd": "/image-generate\n/image-generate a cyberpunk cat mascot, neon pink, clean vector style",
    "media.video.tag": "Video",
    "media.video.manual.title": "ByteDance Seedance 2.0 Mini",
    "media.video.manual.desc": "4–15 second clips, 480p or 720p, adaptive to 21:9 ratios, up to 9 reference images, 3 reference video URLs, strict first/last frame control, and generated audio.",
    "media.video.cmd": "/video-generate\n/video-generate a 5s product promo, slow dolly-in, tech but not flashy",
    "media.nl.tag": "Trigger",
    "media.nl.title": "Natural language or slash command",
    "media.nl.manual.desc": "Describe what you want in plain language, or run <code>/image-generate</code> / <code>/video-generate</code> with an optional prompt. When key parameters are missing, the agent asks follow-up questions instead of guessing. Generated files are downloaded immediately to <code>/tmp/openchinacode/media/images</code> and <code>/tmp/openchinacode/media/videos</code> with matching metadata JSON.",
  },

  zh: {
    /* ── Meta ── */
    "meta.home.desc": "面向 GLM、Kimi 和 DeepSeek 的中国模型终端编程智能体。",
    "meta.home.ogDesc": "面向 GLM、Kimi 和 DeepSeek 的快速模型路由编程智能体。",
    "meta.manual.title": "OpenChinaCode 手册",
    "meta.manual.desc": "OpenChinaCode 使用与配置手册，涵盖 GLM、Kimi、DeepSeek、任务路由、压缩、LSP 和 Playwright MCP。",
    "meta.manual.ogDesc": "面向中国模型的编程智能体使用与配置指南。",

    /* ── Lang toggle ── */
    "lang.toggle": "EN",
    "lang.toggleTitle": "切换语言",

    /* ── Nav ── */
    "nav.providers": "模型",
    "nav.features": "功能",
    "nav.manual": "手册",
    "nav.quickStart": "快速开始",

    /* ── Hero ── */
    "hero.eyebrow": "GLM · KIMI · DEEPSEEK 编程智能体",
    "hero.lead": "精简的终端编程智能体，基于 opencode 分支构建，围绕中国模型路由、智能压缩、滑动输出预算、人民币成本追踪、LSP 诊断和 Playwright 浏览器测试重新打造。",
    "hero.install": "立即安装",
    "hero.copied": "已复制！",
    "hero.readManual": "阅读手册",
    "hero.release": "最新版本",
    "hero.copy": "复制命令",
    "hero.block.install": "安装",
    "hero.block.upgrade": "升级",

    /* ── Capability strip ── */
    "cap.routing.title": "任务路由",
    "cap.routing.desc": "双层路由：基础子智能体路由加可选 extra LLM 智能分发。",
    "cap.compaction.title": "智能压缩",
    "cap.compaction.desc": "档案评判 + 活跃任务提取 + 原始近期尾部。",
    "cap.budgets.title": "输出预算",
    "cap.budgets.desc": "模型感知的最大 token 预算，带溢出安全触发器。",
    "cap.vision.title": "增强视觉",
    "cap.vision.desc": "补全自然识图能力，复制粘贴图片让任意模型识图。",

    /* ── Stats ── */
    "stats.providers": "提供商系列",
    "stats.routes": "任务路由类型",
    "stats.layers": "压缩层级",
    "stats.rmb": "人民币成本追踪",

    /* ── Providers section ── */
    "providers.eyebrow": "模型路由",
    "providers.title": "为中国模型编程而生，<br>而非仅仅接入中国模型。",
    "providers.lead": "OpenChinaCode 保留了 opencode 终端优先的工作流，然后将默认模型范围收窄至 GLM、Kimi 和 DeepSeek，配合模型感知的请求转换、任务路由、压缩、测试和人民币成本显示。",
    "providers.glm.tag": "规划",
    "providers.glm.title": "GLM 主导推理",
    "providers.glm.desc": "架构、复杂规划和大型重构倾向于使用 GLM-5.2 变体进行深度推理。",
    "providers.kimi.tag": "构建",
    "providers.kimi.title": "Kimi 追求速度",
    "providers.kimi.desc": "快速审查、实现、探索、摘要和压缩子智能体在任务匹配时使用快速的 Kimi K3 路由。",
    "providers.deepseek.tag": "调试",
    "providers.deepseek.title": "DeepSeek 用于循环",
    "providers.deepseek.desc": "调试和测试修复循环针对 DeepSeek 进行调优，具有滑动最大 token 行为。",

    /* ── Features section ── */
    "features.eyebrow": "功能特性",
    "features.title": "所需即所有，<br>冗余皆去除。",
    "features.routing.title": "智能子智能体路由",
    "features.routing.desc": "规划、架构、重构、审查、实现、探索、调试、测试修复、摘要、压缩和视觉检查各有快速/中等/复杂路由。",
    "features.compaction.title": "智能压缩管线",
    "features.compaction.desc": "手动或自动压缩保留通用摘要，以更高粒度提取活跃任务，并可通过 <code>/compact keep N</code> 保留原始近期轮次。",
    "features.budgets.title": "模型感知 Token 预算",
    "features.budgets.desc": "<code>/auto-maxtokens</code> 使用官方模型窗口、任务信号和溢出检查，使复杂编程轮次可以请求大输出而无需不必要的压缩。",
    "features.tuning.title": "中国提供商调优",
    "features.tuning.desc": "GLM、Kimi 和 DeepSeek 使用直连官方 OpenAI 兼容 API，具有提供商特定的最大 token、推理、采样和工具调用行为。",
    "features.browser.title": "浏览器测试工作流",
    "features.browser.desc": "<code>/test-mcp</code>、<code>/browser-check</code> 和 <code>/integration-test</code> 将 Playwright MCP 和测试报告接入智能体工作流。",
    "features.costs.title": "可见成本与诊断",
    "features.costs.desc": "TUI 显示人民币成本、模型感知的上下文使用量、路由详情、LSP 诊断和压缩调试阶段，使行为可检查。",

    /* ── Media highlight ── */
    "media.eyebrow": "原生媒体生成",
    "media.title": "在终端中生成图片和视频，<br>无需切换工具。",
    "media.desc": "用自然语言描述或使用斜杠命令。OpenChinaCode 通过火山方舟路由图片和视频生成，自动下载到本地文件。",
    "media.image.tag": "生图",
    "media.image.title": "字节跳动 Seedream 5.0 Pro",
    "media.image.desc": "最高 2K 分辨率，多种宽高比，参考图支持，PNG/JPEG 输出。",
    "media.image.cmd": "/image-generate 一只赛博朋克猫 mascot",
    "media.video.tag": "生视频",
    "media.video.title": "字节跳动 Seedance 2.0 Mini",
    "media.video.desc": "4 至 15 秒短片，720p，首尾帧控制，参考图，生成音频。",
    "media.video.cmd": "/video-generate 一个 5 秒产品宣传短片",
    "media.nl.title": "自然语言或斜杠命令",
    "media.nl.desc": "直接描述需求，或运行 <code>/image-generate</code> 和 <code>/video-generate</code> 并附加可选提示词。缺少关键参数时会追问，而非随意猜测。",

    /* ── Updates strip ── */
    "updates.label": "近期更新",
    "updates.tag.musttry": "推荐尝试",
    "updates.tag.new": "新功能",
    "updates.tag.enhance": "增强",
    "updates.1": "项目权限策略面板 — 按项目选择 Trust All、Safe、Readonly 或 Ask Everything",
    "updates.2": "Extra 任务路由 — 快速 LLM 判定后自动分发子任务",
    "updates.3": "Session 选择器 — 方向键切换当前项目 / 全部项目",
    "updates.4": "原生图片与视频生成，接入火山方舟",
    "updates.5": "粘贴图片视觉预处理，GLM-5V 赋能所有模型",
    "updates.6": "双层路由 — 基础路由加可选 extra 智能分发",
    "updates.7": "Soul 人格选择 — 按项目选择严谨、友好或自定义人格",
    "updates.8": "百度 Unlimited-OCR — 原生文档解析，支持 PDF、DOC、PPT 及图片",

    /* ── OCR hero ── */
    "ocr.eyebrow": "原生 OCR 与文档解析",
    "ocr.hero.title": "在终端里把 PDF、文档和图片<br>解析为 Markdown。",
    "ocr.hero.desc": "由百度 Unlimited-OCR 驱动。粘贴文档或图片，即可获得结构化的 Markdown 和 JSON。无需本地 GPU。",
    "ocr.hero.cta": "阅读手册",

    /* ── OCR manual section ── */
    "ocr.section.title": "原生 OCR 与文档解析",
    "ocr.section.desc": "OpenChinaCode 集成百度 Unlimited-OCR，提供云端原生文档解析。提交 PDF、Office 文档或图片，即可获得结构化的 Markdown 和 JSON — 无需本地 GPU 或推理环境。",
    "ocr.auth.tag": "认证",
    "ocr.auth.title": "百度 Unlimited-OCR 凭证",
    "ocr.auth.desc": "在 TUI 中运行 <code>/ocr-auth</code>，或设置 <code>BAIDU_OCR_API_KEY</code> 和 <code>BAIDU_OCR_SECRET_KEY</code> 环境变量。密钥存储在 <code>~/.local/share/openchinacode/auth.json</code> 中，provider 为 <code>baidu-unlimited-ocr</code>。",
    "ocr.formats.tag": "格式",
    "ocr.formats.title": "支持的文件类型",
    "ocr.formats.desc": "文档：<code>pdf</code>、<code>ofd</code>、<code>doc</code>、<code>docx</code>、<code>txt</code>、<code>wps</code>、<code>ppt</code>、<code>pptx</code>。图片：<code>jpg</code>、<code>jpeg</code>、<code>png</code>、<code>bmp</code>、<code>tif</code>、<code>tiff</code>。输出保存到 <code>/tmp/openchinacode/ocr</code>，包含 Markdown + JSON + 元数据。",
    "ocr.nl.tag": "触发",
    "ocr.nl.title": "粘贴或斜杠命令",
    "ocr.nl.desc": "运行 <code>/ocr</code> 并传入文件路径，或在 TUI 中 <code>Ctrl+V</code> 粘贴文档。文档文件始终走 OCR；图片仅在你明确要求提取文字、解析表格或转 Markdown 时才走 OCR。普通截图和 UI 图片仍走视觉模型。",

    /* ── CTA ── */
    "cta.title": "需要确切的命令和配置文件？",
    "cta.desc": "手册记录了斜杠命令、提供商认证、任务策略覆盖、智能压缩、LSP、Playwright MCP 和调试日志。",
    "cta.button": "打开手册",

    /* ── Footer ── */
    "footer.text": "OpenChinaCode 是基于 opencode 项目的独立分支，出于对原项目的敬意而构建。",
    "footer.manual": "手册",
    "footer.home": "首页",
    "footer.install": "安装",
    "footer.releases": "版本",

    /* ── Manual hero ── */
    "manual.eyebrow": "使用与配置指南",
    "manual.lead": "本页涵盖 OpenChinaCode 专属工作流：GLM/Kimi/DeepSeek 提供商配置、自定义斜杠命令、任务策略路由、智能压缩、LSP 诊断和 Playwright 测试。",
    "manual.titleSuffix": "手册",

    /* ── TOC ── */
    "toc.quickstart": "快速开始",
    "toc.config": "配置",
    "toc.commands": "斜杠命令",
    "toc.routing": "任务路由",
    "toc.compaction": "压缩",
    "toc.testing": "LSP 与测试",
    "toc.debugging": "调试",
    "toc.sessions": "Session 管理",

    /* ── Quick Start ── */
    "qs.title": "快速开始",
    "qs.desc": "OpenChinaCode 作为独立命令安装，可与上游 opencode 共存。",
    "qs.install.tag": "安装",
    "qs.install.title": "安装二进制文件",
    "qs.auth.tag": "认证",
    "qs.auth.title": "添加提供商凭证",
    "qs.run.tag": "运行",
    "qs.run.title": "在项目中启动",

    /* ── Configuration ── */
    "config.title": "配置文件",
    "config.desc": "OpenChinaCode 使用独立的配置和数据路径。请勿将 API 密钥放入代码仓库。",
    "config.global.tag": "全局",
    "config.global.title": "用户配置",
    "config.global.desc": "用于个人默认设置：模型、任务策略覆盖、LSP、压缩和 MCP。",
    "config.auth.tag": "认证",
    "config.auth.title": "本地凭证",
    "config.auth.desc": "由 <code>openchinacode providers login</code> 写入。CLI 写入时文件权限受限。",
    "config.project.tag": "项目",
    "config.project.title": "项目覆盖",
    "config.project.desc": "当某个代码库需要不同的任务策略或测试设置时使用。",
    "config.authShape": "认证文件结构",
    "config.providerIds": "主要提供商 ID",
    "config.table.provider": "提供商",
    "config.table.purpose": "用途",
    "config.table.protocol": "协议",
    "config.table.notes": "备注",
    "config.glm.purpose": "GLM / BigModel 按量付费",
    "config.glm.notes": "基础 URL 固定为 <code>https://open.bigmodel.cn/api/paas/v4</code>。",
    "config.kimi.purpose": "Kimi / Moonshot 中国",
    "config.kimi.notes": "用于快速实现、审查、摘要和快速路由。",
    "config.deepseek.purpose": "DeepSeek 官方 API",
    "config.deepseek.notes": "用于调试/测试修复循环和低成本评判路径。",

    /* ── Slash Commands ── */
    "commands.title": "自定义斜杠命令",
    "commands.desc": "OpenChinaCode 专属命令在 TUI 命令面板中归入 <code>OpenChinaCode</code> 分组。",
    "commands.table.command": "命令",
    "commands.table.usage": "用法",
    "commands.table.effect": "效果",
    "commands.maxtokens.effect": "控制滑动输出 token 预算。启发式是推荐的日常模式；LLM 模式使用低成本评判处理模糊轮次。",
    "commands.compact.effect": "运行智能压缩。<code>keep N</code> 还保留最近 N 个原始用户轮次及后续助手/工具消息。",
    "commands.lsp.effect": "启用语言服务器诊断，使模型可以看到并修复类型、语法和引用错误。",
    "commands.taskpolicy.effect": "打开本地 TUI 任务路由表。<code>on</code>/<code>off</code> 热切换整个 task policy 和 task subagent 入口；<code>extra-on</code>/<code>extra-off</code> 开关 extra 任务路由；<code>extra-status</code> 查看当前状态。不调用模型，不注入对话。",
    "commands.soul.effect": "选择对话人格。<code>custom</code> 保存到 <code>.openchinacode/souls/custom.md</code>，并写入 <code>soul.active</code> + <code>soul.custom_path</code> 到项目配置。刷新实例，对新 turn 生效。不调用模型。",
    "commands.taskclassify.effect": "请求当前模型解释任务类型、复杂度、路由和分类信号。",
    "commands.testmcp.effect": "写入 Playwright MCP 配置，并在 TUI 内热连接或断开。",
    "commands.browsercheck.effect": "提示智能体运行浏览器级别检查，优先通过 Playwright MCP。",
    "commands.integrationtest.effect": "提示智能体使用 OpenChinaCode 集成测试工作流：运行、检查报告、定义缺陷、修复、重跑。",
    "commands.mediaauth.effect": "保存火山方舟 API key，供原生图片和视频生成使用。",
    "commands.imagegen.effect": "打开字节跳动 Seedream 5.0 Pro 生图向导，支持内联提示词。",
    "commands.videogen.effect": "打开字节跳动 Seedance 2.0 Mini 生视频向导，支持内联提示词。",
    "commands.ocrauth.effect": "保存百度 Unlimited-OCR API Key 和 Secret Key，供 <code>ocr_extract</code> 使用。存储于 <code>~/.local/share/openchinacode/auth.json</code>，provider 为 <code>baidu-unlimited-ocr</code>。环境变量兜底：<code>BAIDU_OCR_API_KEY</code> + <code>BAIDU_OCR_SECRET_KEY</code>。",
    "commands.ocr.effect": "打开百度 Unlimited-OCR 文档解析向导。支持 PDF、OFD、DOC、DOCX、TXT、WPS、PPT、PPTX 及图片格式。结果保存到 <code>/tmp/openchinacode/ocr</code>，包含 Markdown + JSON + 元数据。",
    "commands.sessions.effect": "打开 session 选择器。使用方向键在当前项目和全部项目 session 之间切换。",
    "commands.permissions.effect": "打开项目权限策略面板。可选 Trust All、Safe、Ask Everything、Readonly 或 Reset。写入 <code>./.openchinacode/openchinacode.jsonc</code> 并立即下发 runtime override 生效。",

    /* ── Task Routing ── */
    "routing.title": "任务路由策略",
    "routing.desc": "子智能体按任务类型和复杂度路由。通用任务继承父模型；专业任务使用预设的 GLM/Kimi/DeepSeek 默认配置。",
    "routing.table.kind": "任务类型",
    "routing.table.quick": "快速",
    "routing.table.medium": "中等",
    "routing.table.complex": "复杂",
    "routing.override": "覆盖示例",
    "routing.overrideDesc": "将其放入 <code>~/.config/openchinacode/openchinacode.jsonc</code> 或项目级 OpenChinaCode 配置中。",

    /* ── Extra Task Router ── */
    "routing.extra.title": "Extra 任务路由",
    "routing.extra.desc": "开启后，普通 prompt 会先经过快速 LLM 判定，适合时自动插入路由子任务——无需显式调用 <code>/task</code>。默认关闭。",
    "routing.extra.base.tag": "基础",
    "routing.extra.base.title": "系统级基础路由",
    "routing.extra.base.desc": "显式 task/subagent 调用触发内置路由表 — GLM 负责规划，Kimi 负责速度，DeepSeek 负责调试。",
    "routing.extra.smart.tag": "Extra",
    "routing.extra.smart.title": "Extra 智能分发",
    "routing.extra.smart.desc": "快速评判模型（DeepSeek V4 Flash）检查每个普通 prompt，适合委派时自动插入带 task_kind + complexity 的子任务。",
    "routing.extra.control.tag": "控制",
    "routing.extra.control.title": "开关与配置",
    "routing.extra.control.desc": "使用 <code>/task-policy extra-on</code> / <code>extra-off</code> / <code>extra-status</code>，或在配置中设置 <code>task_policy.extra_router.enabled</code>。",
    "routing.extra.config": "{\n  \"task_policy\": {\n    \"extra_router\": {\n      \"enabled\": true,\n      \"confidence_threshold\": 0.7,\n      \"allow\": [\"plan\", \"refactor\", \"review\", \"debug\", \"test_fix\"],\n      \"deny\": [\"general\", \"summarize\", \"compaction\"]\n    }\n  }\n}",

    /* ── Compaction ── */
    "compaction.title": "智能压缩",
    "compaction.desc": "OpenChinaCode 压缩通过任务策略路由，默认使用 <code>moonshotai-cn/kimi-k3#high</code>。它使用三层：通用摘要、活跃任务提取和最小原始近期尾部。",
    "compaction.strategy.tag": "策略",
    "compaction.strategy.title": "档案感知摘要",
    "compaction.strategy.desc": "评判模型首先输出稳定的 JSON 档案，然后 OpenChinaCode 根据该档案构建固定的 Markdown 压缩提示词。",
    "compaction.recent.tag": "近期",
    "compaction.recent.title": "活跃任务提取",
    "compaction.recent.desc": "近期活跃任务以比通用摘要更高的粒度提取，使长调试或重构上下文得以保留。",
    "compaction.manual.tag": "手动",
    "compaction.manual.title": "原始尾部保留",
    "compaction.manual.desc": "<code>/compact keep N</code> 要求 OpenChinaCode 保留最近 N 个原始用户轮次及其后续助手/工具消息。",

    /* ── LSP & Testing ── */
    "testing.title": "LSP 与浏览器测试",
    "testing.lsp.tag": "LSP",
    "testing.lsp.title": "编程轮次中的诊断",
    "testing.lsp.desc": "使用 <code>/lsp on</code>。启用后，语言服务器诊断可在代码编辑时输入给模型。",
    "testing.mcp.tag": "MCP",
    "testing.mcp.title": "从 TUI 启动 Playwright",
    "testing.mcp.desc": "使用 <code>/test-mcp on</code>。写入 Playwright MCP 配置并热连接，无需离开 OpenChinaCode。",
    "testing.vision.tag": "视觉",
    "testing.vision.title": "截图解读",
    "testing.vision.desc": "视觉检查路由到 <code>zhipuai-pay2go/glm-5v-turbo</code>。动画检查应优先使用 DOM/CSS 遥测和像素差异。",

    /* ── Debugging ── */
    "debugging.title": "调试与可观测性",
    "debugging.desc": "TUI 中的子智能体行显示所选提供商、模型、变体、任务分类和路由来源。",
    "debugging.route.tag": "路由",
    "debugging.route.title": "子智能体路由日志",
    "debugging.compact.tag": "压缩",
    "debugging.compact.title": "压缩档案日志",
    "debugging.test.tag": "测试",
    "debugging.test.title": "集成测试报告",

    /* ── Session Management ── */
    "sessions.title": "Session 管理",
    "sessions.desc": "使用 <code>/sessions</code>（别名 <code>/resume</code>、<code>/continue</code>）打开 session 选择器。使用方向键切换范围。",
    "sessions.scope.tag": "范围",
    "sessions.scope.title": "方向键切换范围",
    "sessions.scope.desc": "按 <code>←</code> / <code>→</code> 在<strong>当前项目</strong>（支持 pin/unpin）和<strong>全部项目</strong>（全局 session 列表）之间切换。",
    "sessions.cross.tag": "跨项目",
    "sessions.cross.title": "跨项目 fork",
    "sessions.cross.desc": "选择其它项目的 session 时可选择：打开原项目继续，或 fork 到当前目录继续。",
    "sessions.manage.tag": "管理",
    "sessions.manage.title": "删除与重命名",
    "sessions.manage.desc": "删除（需二次确认）和重命名在两种范围下均可用。",

    /* ── Media Generation ── */
    "toc.media": "媒体生成",
    "toc.ocr": "OCR 与文档",
    "media.manual.title": "原生媒体生成",
    "media.manual.desc": "OpenChinaCode 可通过火山方舟生成图片和视频，由字节跳动 Seedream 5.0 Pro 和 Seedance 2.0 Mini 驱动。",
    "media.auth.tag": "认证",
    "media.auth.title": "火山方舟凭证",
    "media.auth.desc": "在 TUI 中运行 <code>/media-auth</code>，或设置 <code>ARK_API_KEY</code> 环境变量。密钥存储在 <code>~/.local/share/openchinacode/auth.json</code> 中，提供商为 <code>volcengine-ark</code>。",
    "media.image.tag": "生图",
    "media.image.manual.title": "字节跳动 Seedream 5.0 Pro",
    "media.image.manual.desc": "最高 2K 分辨率，1:1 至 21:9 宽高比，最多 10 张参考图（本地路径、URL 或 data URI），PNG 或 JPEG 输出。",
    "media.image.cmd": "/image-generate\n/image-generate 一只赛博朋克猫 mascot，粉色霓虹，干净矢量风",
    "media.video.tag": "生视频",
    "media.video.manual.title": "字节跳动 Seedance 2.0 Mini",
    "media.video.manual.desc": "4–15 秒短片，480p 或 720p，自适应至 21:9 比例，最多 9 张参考图，3 个参考视频 URL，严格首尾帧控制，生成音频。",
    "media.video.cmd": "/video-generate\n/video-generate 一个 5 秒项目宣传短片，镜头缓慢推进，科技感但不浮夸",
    "media.nl.tag": "触发",
    "media.nl.title": "自然语言或斜杠命令",
    "media.nl.manual.desc": "用自然语言描述需求，或运行 <code>/image-generate</code> / <code>/video-generate</code> 并附加可选提示词。缺少关键参数时，智能体会追问而非猜测。生成文件会立即下载到 <code>/tmp/openchinacode/media/images</code> 和 <code>/tmp/openchinacode/media/videos</code>，并写入同名 metadata JSON。",
  },
};

function getLang() {
  const stored = localStorage.getItem("occ-lang");
  if (stored === "en" || stored === "zh") return stored;
  return navigator.language?.startsWith("zh") ? "zh" : "en";
}

function applyLang(lang) {
  localStorage.setItem("occ-lang", lang);
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  const dict = I18N[lang];

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] !== undefined) el.textContent = dict[key];
  });

  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (dict[key] !== undefined) el.innerHTML = dict[key];
  });

  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (dict[key] !== undefined) el.title = dict[key];
  });

  document.querySelectorAll("[data-i18n-meta]").forEach((el) => {
    const key = el.getAttribute("data-i18n-meta");
    if (dict[key] !== undefined) el.setAttribute("content", dict[key]);
  });
}

function toggleLang() {
  applyLang(getLang() === "en" ? "zh" : "en");
}

applyLang(getLang());
