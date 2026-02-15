# Setting Up the Engram Memory GPT

Step-by-step guide to create a Custom GPT with persistent memory via Engram.

## Prerequisites

- A ChatGPT Plus or Team subscription (required for custom GPTs)
- An Engram account at [openengram.ai](https://openengram.ai)
- Your API key and User ID from the Engram dashboard

## Step 1: Create a New GPT

1. Go to [chat.openai.com](https://chat.openai.com)
2. Click your profile icon → **My GPTs** → **Create a GPT**
3. Switch to the **Configure** tab

## Step 2: Basic Configuration

- **Name**: "Memory Assistant" (or whatever you prefer)
- **Description**: "An assistant with persistent memory that remembers across conversations."
- **Instructions**: Copy the system prompt from [CUSTOM-GPT-INSTRUCTIONS.md](./CUSTOM-GPT-INSTRUCTIONS.md)

## Step 3: Add the OpenAPI Action

1. Scroll down to **Actions** → click **Create new action**
2. Click **Import from URL** or paste the schema directly
   - If importing: host the `openapi-gpt.yaml` file at a public URL
   - If pasting: copy the entire contents of [`openapi-gpt.yaml`](./openapi-gpt.yaml) into the schema editor
3. You should see the endpoints appear: `createMemory`, `searchMemories`, `getMemory`, `deleteMemory`, `loadContext`

## Step 4: Configure Authentication

1. In the Action editor, click **Authentication**
2. Select **API Key**
3. Set **Auth Type** to "API Key"
4. Set **Header name** to `X-AM-API-Key`
5. Paste your Engram API key as the value

> **Important**: You also need the `X-AM-User-ID` header. Since ChatGPT's custom GPT actions only support one API key header natively, you have two options:
>
> **Option A** (Recommended): Set the `X-AM-User-ID` in the schema as a fixed default value by editing the `securitySchemes` section.
>
> **Option B**: Add it as a second API Key auth scheme — ChatGPT may prompt you for both during setup.

## Step 5: Test the GPT

1. Click **Preview** in the top right
2. Say something like: "Remember that my favorite color is blue"
3. The GPT should call `createMemory` to store this
4. Start a **new conversation** with the GPT
5. Ask: "What's my favorite color?"
6. The GPT should call `loadContext` or `searchMemories` and recall "blue"

## Step 6: Publish (Optional)

1. Click **Save** → choose visibility:
   - **Only me** — personal use
   - **Anyone with a link** — share with others (each user needs their own Engram API key)
   - **Everyone** — list in the GPT Store
2. Click **Confirm**

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Authentication failed" | Double-check your API key and User ID headers |
| "No memories found" | Make sure you've stored at least one memory first |
| GPT doesn't call actions | Ensure the instructions clearly tell it to use memory tools |
| Rate limited | Free tier has limits; check your usage at openengram.ai |

## Privacy Note

All memories are stored in your Engram account and are only accessible with your API key. The GPT itself does not retain any data between conversations — all persistence is handled by Engram.
