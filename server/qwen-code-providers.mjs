// GENERATED from QwenLM/qwen-code v0.26.6 (commit 042c023), Apache-2.0,
// packages/core/src/providers/all-providers.ts (ALL_PROVIDERS, display order)
// and packages/core/src/providers/presets/*.ts. These are the providers the
// CLI's own /auth menu offers ("QwenCloud", "Alibaba ModelStudio",
// "Third-party Providers", "Custom Provider"; docs/users/configuration/auth.md
// lines 3-8). Functions in the presets are evaluated per base URL (name
// prefix) or replaced by data (keyRule = validateApiKey). Regenerate when the
// supported qwen-code version changes; do not hand-edit model lists.
export const QWEN_CODE_PRESET_VERSION = "0.26.6";

export const QWEN_CODE_PROVIDERS = Object.freeze([
  {
    "id": "qwencloud-token-plan",
    "label": "Token Plan",
    "group": "qwencloud",
    "flowTitle": "QwenCloud",
    "source": "packages/core/src/providers/presets/qwencloud-token-plan.ts",
    "protocol": "openai",
    "envKey": "QWENCLOUD_TOKEN_PLAN_API_KEY",
    "baseUrls": [
      {
        "id": "cn-qianwenai",
        "label": "China — 千问AI平台",
        "url": "https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1",
        "prefix": "QwenCloud Token Plan"
      },
      {
        "id": "intl-qwencloud",
        "label": "International — QwenCloud",
        "url": "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1",
        "prefix": "QwenCloud Token Plan for Global/Intl"
      }
    ],
    "modelsEditable": true,
    "keyRule": {
      "prefix": "sk-sp-"
    },
    "keyPlaceholder": "sk-sp-...",
    "models": [
      {"id":"qwen3.8-max","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","xhigh"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.7-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.8-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","xhigh"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"deepseek-v4-pro-0813","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4.1-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"glm-5.3","contextWindowSize":1000000,"enableThinking":true}
    ]
  },
  {
    "id": "qwencloud-standard",
    "label": "Standard API Key",
    "group": "qwencloud",
    "flowTitle": "QwenCloud",
    "source": "packages/core/src/providers/presets/qwencloud-standard.ts",
    "protocol": "openai",
    "envKey": "QWENCLOUD_API_KEY",
    "baseUrls": [
      {
        "id": "cn-qianwenai",
        "label": "China — 千问AI平台",
        "url": "https://maas.qianwenaiapi.com/compatible-mode/v1",
        "prefix": "QwenCloud Standard"
      },
      {
        "id": "intl-qwencloud",
        "label": "International — QwenCloud",
        "url": "https://maas.qwencloudapi.com/compatible-mode/v1",
        "prefix": "QwenCloud Standard"
      }
    ],
    "modelsEditable": true,
    "keyRule": {
      "prefix": "sk-",
      "notPrefix": "sk-sp-"
    },
    "keyPlaceholder": "sk-...",
    "models": [
      {"id":"qwen3.8-max","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","xhigh"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.7-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.8-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","xhigh"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"deepseek-v4-pro-0813","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4.1-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"kimi-k3","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"max","canDisable":false,"disableField":"reasoning_effort"}},"contextWindowSize":1000000,"thinkingMandatory":true,"modalities":{"image":true}},
      {"id":"glm-5.3","contextWindowSize":1000000,"enableThinking":true}
    ]
  },
  {
    "id": "coding-plan",
    "label": "Coding Plan",
    "group": "alibaba",
    "flowTitle": "Alibaba ModelStudio",
    "source": "packages/core/src/providers/presets/alibaba-coding-plan.ts",
    "protocol": "openai",
    "envKey": "BAILIAN_CODING_PLAN_API_KEY",
    "baseUrls": [
      {
        "id": "aliyun",
        "label": "China (Beijing)",
        "url": "https://coding.dashscope.aliyuncs.com/v1",
        "prefix": "ModelStudio Coding Plan"
      },
      {
        "id": "alibabacloud",
        "label": "Singapore (International)",
        "url": "https://coding-intl.dashscope.aliyuncs.com/v1",
        "prefix": "ModelStudio Coding Plan for Global/Intl"
      }
    ],
    "modelsEditable": true,
    "keyRule": {
      "prefix": "sk-sp-"
    },
    "keyPlaceholder": "sk-sp-...",
    "models": [
      {"id":"qwen3.5-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.6-plus","description":"Currently available to Pro subscribers only.","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.7-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"glm-5","contextWindowSize":202752,"enableThinking":true},
      {"id":"kimi-k2.5","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"MiniMax-M2.5","contextWindowSize":196608,"enableThinking":true},
      {"id":"qwen3-coder-plus","contextWindowSize":1000000},
      {"id":"qwen3-coder-next","contextWindowSize":262144},
      {"id":"qwen3-max-2026-01-23","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true},
      {"id":"glm-4.7","contextWindowSize":202752,"enableThinking":true}
    ]
  },
  {
    "id": "token-plan",
    "label": "Token Plan",
    "group": "alibaba",
    "flowTitle": "Alibaba ModelStudio",
    "source": "packages/core/src/providers/presets/alibaba-token-plan.ts",
    "protocol": "openai",
    "envKey": "BAILIAN_TOKEN_PLAN_API_KEY",
    "baseUrls": [
      {
        "id": "cn-beijing",
        "label": "China (Beijing)",
        "url": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Token Plan"
      },
      {
        "id": "ap-southeast-1",
        "label": "Singapore (International)",
        "url": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Token Plan for Global/Intl"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"qwen3.7-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.6-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.7-max","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"qwen3.8-max","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","high","xhigh","max"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.6-flash","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"deepseek-v4-pro","capabilities":{"reasoning":{"thinking":true,"efforts":["high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4-flash-0731","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4.1-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"deepseek-v4.1-flash-1017","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"kimi-k2.7-code","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true,"thinkingMandatory":true,"modalities":{"image":true,"video":true}},
      {"id":"kimi-k2.6","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true},
      {"id":"kimi-k2.5","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"glm-5.3","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"thinkingMandatory":true},
      {"id":"glm-5.2","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"glm-5.1","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":202752,"enableThinking":true},
      {"id":"glm-5","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":202752,"enableThinking":true},
      {"id":"MiniMax-M2.5","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"enable_thinking"}},"contextWindowSize":196608,"enableThinking":true,"thinkingMandatory":true},
      {"id":"qwen3.8-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","high","xhigh","max"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"deepseek-v4-pro-0813","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000}
    ]
  },
  {
    "id": "alibabaStandard",
    "label": "Standard API Key",
    "group": "alibaba",
    "flowTitle": "Alibaba ModelStudio",
    "source": "packages/core/src/providers/presets/alibaba-standard.ts",
    "protocol": "openai",
    "envKey": "DASHSCOPE_API_KEY",
    "baseUrls": [
      {
        "id": "cn-beijing",
        "label": "China (Beijing)",
        "url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Standard"
      },
      {
        "id": "sg-singapore",
        "label": "Singapore",
        "url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Standard"
      },
      {
        "id": "us-virginia",
        "label": "US (Virginia)",
        "url": "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Standard"
      },
      {
        "id": "cn-hongkong",
        "label": "China (Hong Kong)",
        "url": "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
        "prefix": "ModelStudio Standard"
      }
    ],
    "modelsEditable": true,
    "keyRule": {
      "prefix": "sk-",
      "notPrefix": "sk-sp-"
    },
    "keyPlaceholder": "sk-...",
    "models": [
      {"id":"qwen3.6-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"qwen3.7-plus","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"qwen3.7-max","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"glm-5.3","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true,"thinkingMandatory":true},
      {"id":"glm-5.2","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":1000000,"enableThinking":true},
      {"id":"glm-5.1","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":202752,"enableThinking":true},
      {"id":"deepseek-v4-pro","capabilities":{"reasoning":{"thinking":true,"efforts":["high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4.1-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"deepseek-v4.1-flash-1017","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000,"modalities":{"image":true}},
      {"id":"qwen3.8-max","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","high","xhigh","max"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.8-max-0902","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","high","xhigh","max"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"qwen3.8-flash","capabilities":{"reasoning":{"thinking":true,"efforts":["low","medium","high","xhigh","max"],"defaultEffort":"xhigh","disableField":"reasoning_effort"}},"contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"deepseek-v4-pro-0813","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-v4-flash-0731","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"enable_thinking"}},"contextWindowSize":1000000},
      {"id":"kimi-k3","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"max","canDisable":false,"disableField":"reasoning_effort"}},"contextWindowSize":1000000,"thinkingMandatory":true,"modalities":{"image":true}},
      {"id":"kimi-k2.7-code","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true,"thinkingMandatory":true,"modalities":{"image":true,"video":true}},
      {"id":"kimi-k2.6","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"enable_thinking"}},"contextWindowSize":262144,"enableThinking":true,"modalities":{"image":true,"video":true}}
    ]
  },
  {
    "id": "deepseek",
    "label": "DeepSeek API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/deepseek.ts",
    "protocol": "openai",
    "envKey": "DEEPSEEK_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://api.deepseek.com",
        "prefix": "DeepSeek"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"deepseek-v4-pro","capabilities":{"reasoning":{"profile":"deepseek-openai","thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"thinking"}},"contextWindowSize":1000000},
      {"id":"deepseek-flash","capabilities":{"reasoning":{"profile":"deepseek-openai","thinking":true,"efforts":["low","high","max"],"defaultEffort":"high","disableField":"thinking"}},"contextWindowSize":1000000}
    ]
  },
  {
    "id": "grok",
    "label": "Grok (xAI) API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/grok.ts",
    "protocol": "openai",
    "envKey": "XAI_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://api.x.ai/v1",
        "prefix": "Grok"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"grok-4.5","contextWindowSize":500000},
      {"id":"grok-4.3","contextWindowSize":1000000},
      {"id":"grok-4.20-0309-reasoning","contextWindowSize":1000000},
      {"id":"grok-4.20-0309-non-reasoning","contextWindowSize":1000000},
      {"id":"grok-4.20-multi-agent-0309","contextWindowSize":1000000},
      {"id":"grok-build-0.1","contextWindowSize":262144}
    ]
  },
  {
    "id": "minimax",
    "label": "MiniMax API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/minimax.ts",
    "protocol": "openai",
    "envKey": "MINIMAX_API_KEY",
    "baseUrls": [
      {
        "id": "international",
        "label": "International",
        "url": "https://api.minimax.io/v1",
        "prefix": "MiniMax"
      },
      {
        "id": "china",
        "label": "China",
        "url": "https://api.minimaxi.com/v1",
        "prefix": "MiniMax"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"MiniMax-M3","contextWindowSize":1000000,"modalities":{"image":true,"video":true}},
      {"id":"MiniMax-M2.7","contextWindowSize":204800},
      {"id":"MiniMax-M2.7-highspeed","contextWindowSize":204800},
      {"id":"MiniMax-M2.5","contextWindowSize":196608},
      {"id":"MiniMax-M2.5-highspeed","contextWindowSize":196608},
      {"id":"image-01","imageOnly":true},
      {"id":"image-01-live","imageOnly":true}
    ]
  },
  {
    "id": "zai",
    "label": "Z.AI API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/zai.ts",
    "protocol": "openai",
    "envKey": "ZAI_API_KEY",
    "baseUrls": [
      {
        "id": "standard-api-key",
        "label": "Standard API Key",
        "url": "https://api.z.ai/api/paas/v4",
        "prefix": "Z.AI"
      },
      {
        "id": "coding-plan",
        "label": "Coding Plan",
        "url": "https://api.z.ai/api/coding/paas/v4",
        "prefix": "Z.AI"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"GLM-5.2","contextWindowSize":1000000,"enableThinking":true},
      {"id":"GLM-5.1","contextWindowSize":204800,"enableThinking":true},
      {"id":"GLM-5","contextWindowSize":204800},
      {"id":"GLM-5-Turbo","contextWindowSize":204800}
    ]
  },
  {
    "id": "moonshot",
    "label": "Kimi (Moonshot AI) API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/moonshot.ts",
    "protocol": "openai",
    "envKey": "MOONSHOT_API_KEY",
    "baseUrls": [
      {
        "id": "international",
        "label": "International",
        "url": "https://api.moonshot.ai/v1",
        "prefix": "Kimi"
      },
      {
        "id": "china",
        "label": "China",
        "url": "https://api.moonshot.cn/v1",
        "prefix": "Kimi"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"kimi-k3","capabilities":{"reasoning":{"thinking":true,"efforts":["low","high","max"],"defaultEffort":"max","canDisable":false,"disableField":"reasoning_effort"}},"contextWindowSize":1000000,"thinkingMandatory":true,"modalities":{"image":true,"video":true}},
      {"id":"kimi-k2.7-code","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"thinking"}},"contextWindowSize":262144,"thinkingMandatory":true,"modalities":{"image":true,"video":true}},
      {"id":"kimi-k2.7-code-highspeed","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"canDisable":false,"disableField":"thinking"}},"contextWindowSize":262144,"thinkingMandatory":true,"modalities":{"image":true,"video":true}},
      {"id":"kimi-k2.6","capabilities":{"reasoning":{"thinking":true,"toggleOnly":true,"disableField":"thinking"}},"contextWindowSize":262144,"modalities":{"image":true,"video":true}}
    ]
  },
  {
    "id": "idealab",
    "label": "Idealab API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/idealab.ts",
    "protocol": "openai",
    "envKey": "IDEALAB_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://idealab.alibaba-inc.com/api/openai/v1",
        "prefix": "Idealab"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"Qwen3.6-Plus-DogFooding","contextWindowSize":1000000,"enableThinking":true,"modalities":{"image":true,"video":true}},
      {"id":"bailian/deepseek-v4-pro","contextWindowSize":1000000,"enableThinking":true},
      {"id":"bailian/deepseek-v4-flash","contextWindowSize":1000000,"enableThinking":true},
      {"id":"bailian/kimi-k2.6","contextWindowSize":262144,"enableThinking":true}
    ]
  },
  {
    "id": "modelscope",
    "label": "ModelScope API Key",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/modelscope.ts",
    "protocol": "openai",
    "envKey": "MODELSCOPE_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://api-inference.modelscope.cn/v1",
        "prefix": "ModelScope"
      }
    ],
    "modelsEditable": true,
    "models": [
      {"id":"deepseek-ai/DeepSeek-V4-Flash","contextWindowSize":1000000,"enableThinking":true},
      {"id":"Qwen/Qwen3.5-397B-A17B","contextWindowSize":1000000,"enableThinking":true},
      {"id":"ZhipuAI/GLM-5.1","contextWindowSize":1000000,"enableThinking":true}
    ]
  },
  {
    "id": "openrouter",
    "label": "OpenRouter",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/openrouter.ts",
    "protocol": "openai",
    "envKey": "OPENROUTER_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://openrouter.ai/api/v1",
        "prefix": "OpenRouter"
      }
    ],
    "modelsEditable": true,
    "customHeaders": {
      "HTTP-Referer": "https://github.com/QwenLM/qwen-code.git",
      "X-OpenRouter-Title": "Qwen Code"
    },
    "models": [
      {"id":"z-ai/glm-4.5-air:free","contextWindowSize":128000},
      {"id":"openai/gpt-oss-120b:free","contextWindowSize":131072}
    ]
  },
  {
    "id": "requesty",
    "label": "Requesty",
    "group": "third-party",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/requesty.ts",
    "protocol": "openai",
    "envKey": "REQUESTY_API_KEY",
    "baseUrls": [
      {
        "id": "default",
        "label": "",
        "url": "https://router.requesty.ai/v1",
        "prefix": "Requesty"
      }
    ],
    "modelsEditable": true,
    "customHeaders": {
      "HTTP-Referer": "https://github.com/QwenLM/qwen-code.git",
      "X-Title": "Qwen Code"
    },
    "models": [
      {"id":"openai/gpt-4o-mini","contextWindowSize":128000},
      {"id":"openai/gpt-4o","contextWindowSize":128000}
    ]
  },
  {
    "id": "custom-openai-compatible",
    "label": "Custom Provider",
    "group": "custom",
    "flowTitle": null,
    "source": "packages/core/src/providers/presets/custom-provider.ts",
    "protocol": "openai",
    "protocolOptions": [
      "openai",
      "anthropic",
      "gemini"
    ],
    "envKey": null,
    "baseUrls": [],
    "modelsEditable": true,
    "models": []
  }
]);
