import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const userSessions = {};

const CRYPTOS = {
  BTC: { name: 'Bitcoin', coingeckoId: 'bitcoin', nobitexSymbol: 'btc' },
  ETH: { name: 'Ethereum', coingeckoId: 'ethereum', nobitexSymbol: 'eth' },
  BNB: { name: 'BNB', coingeckoId: 'binancecoin', nobitexSymbol: 'bnb' },
  SOL: { name: 'Solana', coingeckoId: 'solana', nobitexSymbol: 'sol' },
  XRP: { name: 'Ripple', coingeckoId: 'ripple', nobitexSymbol: 'xrp' },
};

async function getCoingeckoPrice(cryptoId) {
  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=usd`);
    return res.data[cryptoId]?.usd ?? null;
  } catch {
    return null;
  }
}

async function getNobitexPrice(nobitexSymbol) {
  try {
    const res = await axios.get(`https://apiv2.nobitex.ir/market/stats?srcCurrency=${nobitexSymbol}&dstCurrency=rls`);
    const stats = res.data.stats[`${nobitexSymbol}-rls`];
    if (!stats || !stats.latest) return null;
    return parseInt(stats.latest) / 10; // Rial to Toman
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

bot.onText(/\/price/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, 'Select an exchange:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'CoinGecko (USD)', callback_data: 'exchange_coingecko' }],
        [{ text: 'Nobitex (Toman)', callback_data: 'exchange_nobitex' }]
      ]
    }
  });
});

bot.onText(/\/buy/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, 'Select an exchange to buy from:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'CoinGecko (USD)', callback_data: 'buy_exchange_coingecko' }],
        [{ text: 'Nobitex (Toman)', callback_data: 'buy_exchange_nobitex' }]
      ]
    }
  });
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('exchange_')) {
    const exchange = data.replace('exchange_', '');
    userSessions[chatId] = { step: 'select_price_crypto', exchange };

    const keyboard = Object.keys(CRYPTOS).map(key => ([{
      text: `${CRYPTOS[key].name} (${key})`,
      callback_data: `price_${key}`
    }]));

    const label = exchange === 'coingecko' ? 'CoinGecko (USD)' : 'Nobitex (Toman)';
    bot.sendMessage(chatId, `Select a cryptocurrency (${label}):`, {
      reply_markup: { inline_keyboard: keyboard }
    });
    bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('price_')) {
    const cryptoKey = data.replace('price_', '');
    const session = userSessions[chatId];
    const exchange = session?.exchange || 'coingecko';

    let price, currency;
    if (exchange === 'nobitex') {
      price = await getNobitexPrice(CRYPTOS[cryptoKey].nobitexSymbol);
      currency = 'Toman';
    } else {
      price = await getCoingeckoPrice(CRYPTOS[cryptoKey].coingeckoId);
      currency = 'USD';
    }

    const text = price
      ? `${CRYPTOS[cryptoKey].name} (${cryptoKey}): ${price.toLocaleString()} ${currency}`
      : `Error fetching price for ${CRYPTOS[cryptoKey].name}. Please try again.`;

    bot.sendMessage(chatId, text);
    bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('buy_exchange_')) {
    const exchange = data.replace('buy_exchange_', '');
    userSessions[chatId] = { step: 'select_crypto', exchange };

    const keyboard = Object.keys(CRYPTOS).map(key => ([{
      text: `${CRYPTOS[key].name} (${key})`,
      callback_data: `crypto_${key}`
    }]));

    bot.sendMessage(chatId, 'Select cryptocurrency to buy:', {
      reply_markup: { inline_keyboard: keyboard }
    });
    bot.answerCallbackQuery(query.id);
  }

  if (data.startsWith('crypto_')) {
    const cryptoKey = data.replace('crypto_', '');
    const session = userSessions[chatId] || {};
    const exchange = session.exchange || 'coingecko';
    userSessions[chatId] = {
      step: 'enter_amount',
      crypto: cryptoKey,
      exchange
    };

    let price, currency;
    if (exchange === 'nobitex') {
      price = await getNobitexPrice(CRYPTOS[cryptoKey].nobitexSymbol);
      currency = 'Toman';
    } else {
      price = await getCoingeckoPrice(CRYPTOS[cryptoKey].coingeckoId);
      currency = 'USD';
    }

    const priceText = price ? `\nCurrent price: ${price.toLocaleString()} ${currency}` : '';

    bot.sendMessage(chatId,
      `Selected: ${CRYPTOS[cryptoKey].name} (${cryptoKey})${priceText}\n\n` +
      `Enter amount in USDT to buy:`
    );
    bot.answerCallbackQuery(query.id);
  }

  if (data === 'confirm_order') {
    const session = userSessions[chatId];
    if (!session || !session.crypto || !session.amount) return;

    const exchange = session.exchange || 'coingecko';
    let price, currency;
    if (exchange === 'nobitex') {
      price = await getNobitexPrice(CRYPTOS[session.crypto].nobitexSymbol);
      currency = 'Toman';
    } else {
      price = await getCoingeckoPrice(CRYPTOS[session.crypto].coingeckoId);
      currency = 'USD';
    }

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
      `Exchange: ${exchange === 'nobitex' ? 'Nobitex' : 'CoinGecko'}\n` +
      `Price: ${price.toLocaleString()} ${currency}\n\n` +
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