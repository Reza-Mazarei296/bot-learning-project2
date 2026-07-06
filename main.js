import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userSessions = {};

const CRYPTOS = {
  BTC: { name: 'Bitcoin', symbol: 'BTCUSDT' },
  ETH: { name: 'Ethereum', symbol: 'ETHUSDT' },
  BNB: { name: 'BNB', symbol: 'BNBUSDT' },
  SOL: { name: 'Solana', symbol: 'SOLUSDT' },
  XRP: { name: 'Ripple', symbol: 'XRPUSDT' },
};

async function getPrice(symbol) {
  try {
    const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat(res.data.price);
  } catch {
    return null;
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `Welcome to Crypto Buy Bot!\n\n` +
    `Available commands:\n` +
    `/buy - Buy cryptocurrency\n` +
    `/price - Check current prices\n` +
    `/help - Show help`
  );
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `How to use this bot:\n\n` +
    `1. Use /buy to start a purchase\n` +
    `2. Select a cryptocurrency\n` +
    `3. Enter the amount in USDT\n` +
    `4. Confirm your order\n\n` +
    `Use /price to check current market prices.`
  );
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  let text = 'Current Prices:\n\n';

  for (const [key, crypto] of Object.entries(CRYPTOS)) {
    const price = await getPrice(crypto.symbol);
    if (price) {
      text += `${key}: $${price.toFixed(2)}\n`;
    }
  }

  bot.sendMessage(chatId, text);
});

bot.onText(/\/buy/, (msg) => {
  const chatId = msg.chat.id;
  userSessions[chatId] = { step: 'select_crypto' };

  const keyboard = Object.keys(CRYPTOS).map(key => ([{
    text: `${CRYPTOS[key].name} (${key})`,
    callback_data: `crypto_${key}`
  }]));

  bot.sendMessage(chatId, 'Select cryptocurrency to buy:', {
    reply_markup: { inline_keyboard: keyboard }
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('crypto_')) {
    const cryptoKey = data.replace('crypto_', '');
    userSessions[chatId] = {
      step: 'enter_amount',
      crypto: cryptoKey
    };

    const price = await getPrice(CRYPTOS[cryptoKey].symbol);
    const priceText = price ? `\nCurrent price: $${price.toFixed(2)}` : '';

    bot.sendMessage(chatId,
      `Selected: ${CRYPTOS[cryptoKey].name} (${cryptoKey})${priceText}\n\n` +
      `Enter amount in USDT to buy:`
    );
    bot.answerCallbackQuery(query.id);
  }

  if (data === 'confirm_order') {
    const session = userSessions[chatId];
    if (!session || !session.crypto || !session.amount) return;

    const price = await getPrice(CRYPTOS[session.crypto].symbol);
    if (!price) {
      bot.sendMessage(chatId, 'Error fetching price. Please try again.');
      bot.answerCallbackQuery(query.id);
      return;
    }

    const quantity = session.amount / price;

    bot.sendMessage(chatId,
      `Order Executed!\n\n` +
      `Bought: ${quantity.toFixed(8)} ${session.crypto}\n` +
      `Spent: $${session.amount} USDT\n` +
      `Price: $${price.toFixed(2)}\n\n` +
      `(Demo mode - no real transaction)`
    );

    delete userSessions[chatId];
    bot.answerCallbackQuery(query.id);
  }

  if (data === 'cancel_order') {
    delete userSessions[chatId];
    bot.sendMessage(chatId, 'Order cancelled.');
    bot.answerCallbackQuery(query.id);
  }
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (!session || session.step !== 'enter_amount') return;
  if (msg.text.startsWith('/')) return;

  const amount = parseFloat(msg.text);

  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(chatId, 'Please enter a valid amount:');
    return;
  }

  session.amount = amount;
  session.step = 'confirm';

  bot.sendMessage(chatId,
    `Order Summary:\n\n` +
    `Cryptocurrency: ${CRYPTOS[session.crypto].name} (${session.crypto})\n` +
    `Amount: $${amount} USDT\n\n` +
    `Confirm your order:`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Confirm', callback_data: 'confirm_order' },
            { text: 'Cancel', callback_data: 'cancel_order' }
          ]
        ]
      }
    }
  );
});

console.log('Bot is running...');