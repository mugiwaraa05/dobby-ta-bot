require('dotenv').config();
const axios = require('axios');
const { Client, GatewayIntentBits, ChannelType, REST, Routes, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .options({
    coin: {
      type: 'string',
      description: 'Coin symbol or CoinGecko ID (e.g., btc or bitcoin)',
      demandOption: false
    },
    interval: {
      type: 'string',
      description: 'Cron schedule (e.g., "0 */1 * * *" for hourly)',
      default: ''
    }
  })
  .argv;

const API_KEY = process.env.FIREWORKS_API_KEY;
const API_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const MODEL = "accounts/sentientfoundation-serverless/models/dobby-mini-unhinged-plus-llama-3-1-8b";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

// ----------------------
// CoinGecko coin list + market cache
// ----------------------
const coinIdCache = {
  _fullList: null,
  _marketsCache: {}
};

async function lookupCoinId(input) {
  const key = input.toLowerCase();

  if (coinIdCache[key]) {
    return coinIdCache[key];
  }

  if (!coinIdCache._fullList) {
    console.log("Fetching CoinGecko coin list...");
    const res = await axios.get("https://api.coingecko.com/api/v3/coins/list");
    coinIdCache._fullList = res.data;
  }

  // Exact id match first
  const exactIdMatch = coinIdCache._fullList.find(c => c.id.toLowerCase() === key);
  if (exactIdMatch) {
    coinIdCache[key] = exactIdMatch.id;
    return exactIdMatch.id;
  }

  // Find all symbol matches
  const symbolMatches = coinIdCache._fullList.filter(c => c.symbol.toLowerCase() === key);
  if (symbolMatches.length === 0) {
    console.error(`No coins found for symbol/id "${input}"`);
    return null;
  }

  // If only one symbol match, use it directly
  if (symbolMatches.length === 1) {
    coinIdCache[key] = symbolMatches[0].id;
    return symbolMatches[0].id;
  }

  // Multiple matches: fetch markets and pick highest market cap coin
  if (!coinIdCache._marketsCache[key]) {
    try {
      const ids = symbolMatches.map(c => c.id).join(',');
      const marketsRes = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
        params: {
          vs_currency: 'usd',
          ids: ids,
        }
      });
      coinIdCache._marketsCache[key] = marketsRes.data;
    } catch (err) {
      console.warn('Error fetching market data for symbol lookup:', err.message);
      // fallback: pick first symbol match
      coinIdCache[key] = symbolMatches[0].id;
      return symbolMatches[0].id;
    }
  }

  const markets = coinIdCache._marketsCache[key];
  if (!markets || markets.length === 0) {
    coinIdCache[key] = symbolMatches[0].id;
    return symbolMatches[0].id;
  }

  // Pick the coin with highest market cap
  const topCoin = markets.reduce((prev, curr) => (curr.market_cap > (prev.market_cap || 0) ? curr : prev), { market_cap: 0 });
  coinIdCache[key] = topCoin.id;
  return topCoin.id;
}

// ----------------------
// Fetch market data from CoinGecko with scam detection
// ----------------------
async function fetchMarketData(coinId) {
  try {
    const currentRes = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}`, {
      params: {
        localization: false,
        tickers: false,
        market_data: true,
        community_data: false,
        developer_data: false,
        sparkline: false
      }
    });

    const current = currentRes.data.market_data;

    const historyRes = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`, {
      params: {
        vs_currency: 'usd',
        days: 7,
        interval: 'daily'
      }
    });

    const history = historyRes.data.prices.map(p => {
      const date = new Date(p[0]);
      return {
        date: date.toISOString().split('T')[0],
        close: p[1]
      };
    });

    // Scam detection: very low price or volume means suspicious
    // You can tweak thresholds here
    const isScam = current.current_price.usd <= 0 || current.total_volume.usd < 1000;

    return {
      price: current.current_price.usd,
      change24h: current.price_change_percentage_24h,
      volume: current.total_volume.usd,
      high24h: current.high_24h.usd,
      low24h: current.low_24h.usd,
      history,
      scam: isScam
    };
  } catch (error) {
    console.error(`CoinGecko API Error for ${coinId}:`, error.message);
    return null;
  }
}

// ----------------------
// Prediction with Dobby + formatted prompt example
// ----------------------
async function predictPrice(data, coinId) {
  if (!API_KEY) throw new Error('FIREWORKS_API_KEY not set in .env');

  if (data.scam) {
    return `❌ Prediction for **${coinId.toUpperCase()}**:\n` +
      `This coin looks dead or suspicious.\n` +
      `No real price or volume activity detected. Avoid trading.\n`;
  }

  const historyStr = data.history
    .map(h => `${h.date}: $${h.close.toFixed(2)}`)
    .join(" | ");

 const prompt = `
You are a crypto market analyst and must respond in this format for Discord with markdown and emojis. Be creative and avoid repitition, say what you think about token stats.:

Prediction for **${coinId}**:

💰 Current price = **$${data.price.toFixed(2)}**  
📉 Last 24h: **${data.change24h.toFixed(2)}%** 
📈 High: **$${data.high24h.toFixed(2)}**, 📉 Low: **$${data.low24h.toFixed(2)}**. Volume’s decent at **$${(data.volume / 1e6).toFixed(2)}M** 🔄  
📅 Last 7 days: Some chill dips, bounced hard day before (8/11). Shit’s neutral.

🔮 **Forecast:** Trading sideways till it decides if it’s long or short game, (based on your intuition from 7 day data)% daily wiggle. Dont Recycle this .


`;

  try {
    const response = await axios.post(API_URL, {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 250,
      temperature: 0.8
    }, {
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const text = response.data?.choices?.[0]?.message?.content
      ?? response.data?.choices?.[0]?.text
      ?? 'No prediction text returned from model.';

    return text.trim();

  } catch (error) {
    console.error(`Dobby 8B Error for ${coinId}:`, error.response?.data?.error || error.message);
    return `Error generating prediction for ${coinId}.`;
  }
}

// ----------------------
// Discord client with slash commands + message posting
// ----------------------

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function registerSlashCommand() {
  if (!CLIENT_ID) {
    console.warn('CLIENT_ID not set. Skipping slash command registration.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const command = new SlashCommandBuilder()
    .setName('predict')
    .setDescription('Get a price prediction for a crypto coin')
    .addStringOption(opt => opt.setName('coin').setDescription('Coin symbol or name (e.g., btc or bitcoin)').setRequired(true))
    .addStringOption(opt => opt.setName('interval').setDescription('Optional cron interval (e.g., 0 */1 * * *)').setRequired(false))
    .toJSON();

  try {
    console.log('Registering global slash command /predict ...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [command] });
    console.log('Slash command registered.');
  } catch (err) {
    console.error('Failed to register slash command:', err.message);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'predict') {
    const coinInput = interaction.options.getString('coin');
    const interval = interaction.options.getString('interval') || '';

    try {
      await interaction.deferReply({ flags:0 });

      const coinId = await lookupCoinId(coinInput);
      if (!coinId) {
        await interaction.editReply(`Could not resolve coin: **${coinInput}**`);
        return;
      }

      const data = await fetchMarketData(coinId);
      if (!data) {
        await interaction.editReply(`Failed to fetch market data for **${coinId}**.`);
        return;
      }

      const prediction = await predictPrice(data, coinId);

      await interaction.editReply(`Prediction for **${coinId}** posted in this channel.`);

      if (interaction.channel && interaction.channel.type === ChannelType.GuildText) {
        await interaction.channel.send(`**${coinId.toUpperCase()} Price Prediction**\n${prediction}`);
      }

      if (interval) {
        cron.schedule(interval, () => {
          runPredictionWithLookup(coinId, interaction.channelId);
        });
        await interaction.followUp(`Scheduled updates every \`${interval}\` for **${coinId}** in this channel.`);
      }
    } catch (err) {
      console.error('Error handling /predict:', err);
      if (interaction.deferred || interaction.replied) {
        try {
          await interaction.editReply('Internal error handling command.');
        } catch {}
      } else {
        try {
          await interaction.reply({ content: 'Internal error', flags: 1 << 6 });
        } catch {}
      }
    }
  }
});

// Run prediction + send to specified channel (used by scheduler too)
async function runPredictionWithLookup(symbolOrId, channelId = CHANNEL_ID) {
  let coinId = symbolOrId;

  if (!coinId.includes("-")) {
    console.log(`Looking up CoinGecko ID for symbol: ${coinId}`);
    const lookedUp = await lookupCoinId(coinId);
    if (!lookedUp) {
      console.error(`Could not resolve coin symbol "${coinId}".`);
      return;
    }
    coinId = lookedUp;
  }

  const data = await fetchMarketData(coinId);
  if (!data) {
    console.error(`Failed to fetch market data for ${coinId}.`);
    return;
  }
  const prediction = await predictPrice(data, coinId);

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel.type === ChannelType.GuildText) {
      await channel.send(`**${coinId.toUpperCase()} Price Prediction**\n${prediction}`);
      console.log(`Posted prediction for ${coinId} in channel ${channelId}`);
    } else {
      console.warn(`Channel ${channelId} is not a text channel.`);
    }
  } catch (e) {
    console.error(`Failed to post prediction to channel ${channelId}:`, e.message);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerSlashCommand();

  // Run CLI command prediction if coin arg provided
  if (argv.coin) {
    await runPredictionWithLookup(argv.coin.toLowerCase(), CHANNEL_ID);
  }

  // Schedule if interval provided via CLI
  if (argv.coin && argv.interval) {
    cron.schedule(argv.interval, () => runPredictionWithLookup(argv.coin.toLowerCase(), CHANNEL_ID));
    console.log(`Scheduled predictions for ${argv.coin.toLowerCase()} with interval ${argv.interval}`);
  }
});

client.login(DISCORD_TOKEN);
