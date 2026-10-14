# Modelflare MCP Server

Image and video generation for any MCP client — Claude Desktop, Cursor, Gemini CLI and more — with one Modelflare **Smart API Key** for every image and video model available to your account.

用一个 Modelflare **Smart API Key**，在任意 MCP 客户端里调用你账号可用的全部图像和视频模型。

mcp-name: io.github.castaly-ai/mcp-server

## Get a Smart API Key / 获取 Smart API Key

1. Sign up / 注册: https://modelflare.dev/sign-up?utm_source=mcp-registry&utm_medium=plugin&utm_campaign=integrations
2. Console → API Keys → **Create Smart API Key**, and pick a routing strategy (Balanced / Stability first / Low price first).

   控制台 API Keys →「Create Smart API Key」，选择路由策略（均衡 / 稳定优先 / 低价优先）。

## Configure / 配置

Add the server to your MCP client:

```json
{
  "mcpServers": {
    "modelflare": {
      "command": "npx",
      "args": ["-y", "@modelflare/mcp-server"],
      "env": {
        "MODELFLARE_API_KEY": "<your Smart API Key>"
      }
    }
  }
}
```

| Variable | Value |
|---|---|
| `MODELFLARE_API_KEY` | your Smart API Key (required) |
| `MODELFLARE_BASE_URL` | `global` → https://modelflare.dev/v1 (default) · `china` → https://origin.modelflare.dev/v1 · or a custom URL |
| `MODELFLARE_OUTPUT_DIR` | where images and videos are saved (default `./modelflare-output`) |
| `MODELFLARE_LOCALE` | `en` (default) or `zh` for error messages |

**Claude Desktop:** download `modelflare-mcp-<version>.mcpb` from [Releases](https://github.com/castaly-ai/modelflare-mcp/releases) and open it; Claude Desktop asks for the API key, base URL and output folder. `node build-mcpb.mjs` rebuilds the bundle.

## Tools / 工具

| Tool | What it does |
|---|---|
| `list_models` | Image and video models your key can call, each with the docs page holding its exact request fields. `kind: "text"` lists text models. |
| `generate_image` | Generates an image, or edits one with `edit: true`, and saves it. Gemini image models use `generateContent`; the others use the Images API. |
| `create_video` | Starts an asynchronous video task and returns its task ID. |
| `get_video_status` | Status and progress of a video task. |
| `download_video` | Saves a finished video; can wait up to 300 seconds first. |

Model-specific fields go in `parameters` (images) or `request` (videos) and are sent unchanged. The model list comes from your key, so new models appear without editing the key. Generated results are saved right away because result URLs expire.

Calls are billed to your Modelflare balance by actual usage; see https://modelflare.dev/usage-logs.

## Troubleshooting / 常见问题

- **401**: the key is missing or invalid. Create a Smart API Key at https://modelflare.dev/keys.
- **`model_not_found`**: a regular key only calls the models of its own group. A Smart API Key calls every model available to your account. If you already use a Smart API Key, that model is not available to your account right now.
- **403 `insufficient_user_quota`**: top up at https://modelflare.dev/billing.

## Links

Docs: https://docs.modelflare.dev/ · Pricing: https://modelflare.dev/pricing

## License

MIT © Havenbyte LLC
