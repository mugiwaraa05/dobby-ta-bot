# Dobby TA Bot
A Node.js Discord bot that predicts short-term cryptocurrency price trends using **Dobby Mini Unhinged Plus Llama 3.1 8B**. It fetches real-time market data from CoinGecko, generates AI-powered predictions (e.g., "BTC to rise 5% due to ETF inflows"), and posts them to a Discord channel via CLI or slash commands (`/predict`). Includes scam detection and coin ID lookup for flexible input (e.g., `btc` or `bitcoin`). Deployable locally or on Render for crypto degens and traders.

## Features
- Fetches price, 24h change, volume, high/low, and 7-day history from CoinGecko.
- Resolves coin symbols (e.g., `btc`) to CoinGecko IDs (e.g., `bitcoin`), prioritizing highest market cap.
- Flags coins with low price or volume as suspicious (scam detection).
- Generates creative 24-48 hour price forecasts with Dobby 8B via Fireworks AI or vLLM.
- Posts predictions to Discord via CLI or `/predict` slash command with markdown and emojis.
- Supports scheduled predictions (e.g., hourly) using `node-cron`.

## Prerequisites
- **Node.js**: Version 18+ (tested with 22.16.0).
- **Fireworks AI API Key**: For Dobby 8B access ([https://fireworks.ai](https://fireworks.ai)).
- **Discord Bot**: Token, client ID, and channel ID from a Discord server.
- **Optional**: vLLM for local Dobby 8B (Python 3.8+, 16GB RAM, GPU recommended).
- **Render Account**: For cloud deployment ([https://render.com](https://render.com)).

## Setup
### Local Setup
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/mugiwaraa05/dobby-ta-bot.git
   cd dobby-ta-bot
   ```

2. **Install Dependencies**:
   ```bash
   npm install axios discord.js node-cron yargs yargs/helpers dotenv
   ```

3. **Create `.env` File**:
   - In the project root (`dobby-ta-bot`), create `.env`:
     ```env
     FIREWORKS_API_KEY=your_fireworks_api_key
     DISCORD_TOKEN=your_discord_bot_token
     CLIENT_ID=your_discord_client_id
     CHANNEL_ID=your_discord_channel_id
     ```
   - **Obtain Credentials**:
     - **Fireworks AI**:
       - Log in to [https://fireworks.ai](https://fireworks.ai).
       - Go to Dashboard > Account Settings > API Keys.
       - Copy key (e.g., `fw_1234567890abcdef`).
     - **Discord Bot**:
       - Go to [https://discord.com/developers/applications](https://discord.com/developers/applications).
       - Create New Application > Name: "DobbyTABot" > Create.
       - Go to Bot tab > Add Bot > Copy Token (e.g., `MTIzNDU2Nzg5MC5hYmNkZWY.abcdef123456`).
       - Go to General Information > Copy Application ID (e.g., `987654321098765432`) as `CLIENT_ID`.
       - Enable Presence, Server Members, and Message Content Intents (Bot tab > Privileged Gateway Intents).
       - Go to OAuth2 > URL Generator > Select `bot` and `applications.commands` scopes > Permissions: "Send Messages", "View Channels" > Copy URL.
       - Open URL in browser, add bot to your server.
       - In Discord, enable Developer Mode (User Settings > Appearance), right-click channel (e.g., `#crypto-predictions`) > Copy ID (e.g., `123456789012345678`).
     - Update `.env` with your values.

4. **Optional: Local vLLM Setup**:
   - Install Python 3.8+ and vLLM: `pip install vllm`.
   - Download Dobby 8B GGUF from [Hugging Face](https://huggingface.co/SentientAGI/Dobby-Mini-Unhinged-Llama-3.1-8B).
   - Run vLLM server: `python -m vllm.entrypoints.api_server --model path/to/dobby-8b-unhinged-q4_k_m.gguf --port 8000`.
   - Update `API_URL` in `price-predictor.js` to `http://localhost:8000/v1/chat/completions`.

### Render Deployment
1. **Push to GitHub**:
   - Ensure `.gitignore` includes:
     ```gitignore
     .env
     node_modules/
     ```
   - Commit and push:
     ```bash
     git add .
     git commit -m "Initial setup"
     git push origin main
     ```

2. **Create Render Service**:
   - Log in to [https://render.com](https://render.com).
   - New > Web Service > Connect GitHub repository (`mugiwaraa05/dobby-ta-bot`).
   - Set:
     - Runtime: Node.
     - Build Command: `npm install`.
     - Start Command: `node price-predictor.js --coin bitcoin --interval "0 */1 * * *"`.
   - Add environment variables in Render dashboard:
     ```env
     FIREWORKS_API_KEY=your_fireworks_api_key
     DISCORD_TOKEN=your_discord_bot_token
     CLIENT_ID=your_discord_client_id
     CHANNEL_ID=your_discord_channel_id
     ```
   - Deploy and verify logs at `https://dashboard.render.com`.

## Usage
### CLI Usage
1. **Manual Prediction**:
   ```bash
   node price-predictor.js --coin btc
   ```
   - Supports CoinGecko IDs (e.g., `bitcoin`) or symbols (e.g., `btc`).
   - Output: Console logs prediction (e.g., `Prediction for bitcoin: Rise 3% due to ETF inflows`).
   - Discord: Posts to specified channel (e.g., `**BITCOIN Price Prediction**: Rise 3% due to ETF inflows`).

2. **Scheduled Prediction**:
   ```bash
   node price-predictor.js --coin btc --interval "0 */1 * * *"
   ```
   - Runs hourly, posting predictions to Discord.

3. **PowerShell**:
   ```powershell
   node C:\Users\PC\Documents\dobby-ta-bot\price-predictor.js --coin btc --interval "0 */1 * * *"
   ```

### Discord Slash Command
1. **Trigger Prediction**:
   - In Discord, use:
     ```
     /predict coin: btc
     ```
   - Optional: Add `interval` (e.g., `0 */1 * * *`) for scheduled updates.
   - Output: Posts prediction to the channel where the command is run.

2. **Verify Slash Command**:
   - Bot registers `/predict` on startup (requires `CLIENT_ID` and `DISCORD_TOKEN`).
   - Check Discord server for command availability.

## License
MIT License. See [LICENSE](LICENSE) for details.