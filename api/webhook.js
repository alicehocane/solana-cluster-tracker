const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1545746746242498620/LjsCpbblr-07w1Gi9GcQrTn39MspeX6sn8lnTbkvcFEJKKjG0x_gFS1QcYlD1eago97-";

// 1. YOUR LIST OF TRACKED WALLETS
const TRACKED_WALLETS = new Set([
    "9oKGw6n6tjGC7mGuS4PLRYx1xSMt2pAzFdCibUjdaX2m",
    "3VMW45SQTeSxFrSozjBbx49qqQ2z6HKUezvakAPwHwhz",
    "GkVZ6BRP3nd8LYwCAdniVdTS2R8zniRbkN5tZhhvLBtY",
    "835GEJgjDt4B4LzC33vYpt6dQXUWJqkkVnWVnGP3WUKN",
    "7UDarSsvMu64SDyL5dayANca8za87tbyeuAdGjMKWf16",
    "7iG1nhuNPXjUq2D2LJXywBE1zAXQQFzDFvf7hKNjZf26",
    "BgpLrxjCPFrvqEUQNrMxhP7ZmDNbjwcaX8fzy3ZuYvzT",
    "BQdbTPv9iuPjU6swSVJEsdv3hutS1UxFstTpx4KRVZEm",
    "3Qchg1ipMKRoqDktu27yNMvcPe3xTHD9q7uJe6Xtbua2",
    "4w8St7tNUNqgAXvXd4BjhkByV1w9vagp2yjUyrnoU4ZS",
    "Ggnm2KVizsXedUrBJqjXtg8ztgCw3C5P6swVfSiFQ2SH",
    "8eGqytw6HWhykdBoA9gNWZv7t7vYr6X8KeoDABU1731y",
    "3bwkvwoYnyC9GMVFn2EWeAJ2YptCnZDWdc284SdWD2gd",
    "3pLheGVtmHLe5xDpVXWLLPmcKquNLTGMEmzTofxLmoCC",
    "8mNGKZAsSwgmhrkVnvhmcuSDW3Bt5s1GSS7uzd93DcmV",
    "BHREKFkPQgAtDs8Vb1UfLkUpjG6ScidTjHaCWFuG2AtX",
    "Hj7UJq2DFqYdPv7JZzWWiRcNG36vD8knmWbggBfXNc51",
    "ALaYhQti7bcSb1MNFjkz4TPTeHKCvdCy3ivN8tmQdh35",
    "5xwjQ3s8jytQ4nBYnBbzM34xSGWtjRAy8dwn9vPKtGNS",
    "E8tXebsK9bKkr44YSkfnmmWftGzcFZboHJcVMt3Kis4w",
    "CTnhDdpKCdRBNXocZgGh4aeM1vxTSsXLT68CTAZLUzWD",
    "ETRwCdhkKYQk6HK58zGAd8aEEpTQuMUBwXhEfG9v2Jb3",
    "CnjMc5DeNmhPSYZ2xFpNqtKGuU8ETTKHqUQwicapboDj",
    "L2vRhKZsQcRUHvy1PEY4dCJ37XhfqHzgRrgAgfs4FFN",
    "ETwAcPeN87KmFm8xPBsSiQCuqnyLgLdU9qevbf5t8KLn"
]);

// 2. TOKENS TO IGNORE (Wrapped SOL, USDC, USDT, Native SOL mints)
const BLACKLISTED_TOKENS = new Set([
    "So11111111111111111111111111111111111111112", // Wrapped SOL (WSOL)
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
]);

const MIN_SOL_SPEND = 0.05; 
const HOLDING_CHECK_MS = 3 * 60 * 1000; // 3 Minutes holding window

global.tokenClusterCache = global.tokenClusterCache || new Map();
// Cache to track pending buys to verify they don't instant-dump
global.pendingBuysCache = global.pendingBuysCache || new Map();

async function sendDiscordAlert(message) {
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
    } catch (error) {
        console.error("Failed to send Discord notification:", error);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    res.status(200).json({ status: 'received' });

    try {
        const transactions = req.body;
        if (!Array.isArray(transactions)) return;

        const now = Date.now();

        for (const tx of transactions) {
            if (tx.type !== 'SWAP') continue;

            const targetAccount = tx.accountData?.find(acc => 
                TRACKED_WALLETS.has(acc.account) && acc.nativeBalanceChange < 0
            );

            if (!targetAccount) continue;
            const involvedTrackedWallet = targetAccount.account;
            const solSpent = Math.abs(targetAccount.nativeBalanceChange) / 1e9;

            if (solSpent < MIN_SOL_SPEND) continue;

            // Check if this is a BUY or a SELL for this wallet
            const isBuy = tx.tokenTransfers?.some(transfer => transfer.toUserAccount === involvedTrackedWallet);
            const isSell = tx.tokenTransfers?.some(transfer => transfer.fromUserAccount === involvedTrackedWallet);

            const tokenTransfer = tx.tokenTransfers?.find(transfer => 
                transfer.toUserAccount === involvedTrackedWallet || transfer.fromUserAccount === involvedTrackedWallet
            );

            if (!tokenTransfer) continue;
            const tokenMint = tokenTransfer.mint;

            if (BLACKLISTED_TOKENS.has(tokenMint)) continue;

            // IF IT'S A SELL: Check if they dumped a pending token within 3 minutes
            if (isSell) {
                const pendingKey = `${involvedTrackedWallet}-${tokenMint}`;
                if (global.pendingBuysCache.has(pendingKey)) {
                    const buyTime = global.pendingBuysCache.get(pendingKey);
                    if (now - buyTime < HOLDING_CHECK_MS) {
                        // They dumped it in under 3 minutes! Cancel/invalidate this buy.
                        global.pendingBuysCache.delete(pendingKey);
                        continue;
                    }
                }
            }

            // IF IT'S A BUY: Log it and check for cluster confluence
            if (isBuy) {
                const pendingKey = `${involvedTrackedWallet}-${tokenMint}`;
                global.pendingBuysCache.set(pendingKey, now);

                if (!global.tokenClusterCache.has(tokenMint)) {
                    global.tokenClusterCache.set(tokenMint, []);
                }

                const buyers = global.tokenClusterCache.get(tokenMint);
                const recentBuyers = buyers.filter(b => now - b.timestamp < (30 * 60 * 1000));

                if (!recentBuyers.some(b => b.wallet === involvedTrackedWallet)) {
                    recentBuyers.push({ wallet: involvedTrackedWallet, timestamp: now });
                }

                global.tokenClusterCache.set(tokenMint, recentBuyers);

                const otherWallets = recentBuyers.filter(b => b.wallet !== involvedTrackedWallet);

                if (otherWallets.length > 0) {
                    const shortWallet = `${involvedTrackedWallet.slice(0, 4)}...${involvedTrackedWallet.slice(-4)}`;
                    const shortToken = `${tokenMint.slice(0, 4)}...${tokenMint.slice(-4)}`;

                    let probabilityScore = otherWallets.length >= 3 ? "🔥 HIGH PUMP PROBABILITY 🔥" : "⚡ Medium ⚡";

                    const message = 
                        `🚨 **CONFLUENCE ALERT (Verified Holder)** 🚨\n\n` +
                        `🪙 **Token:** \`${shortToken}\`\n` +
                        `👤 **Buyer:** \`${shortWallet}\` (Spent ~${solSpent.toFixed(2)} SOL)\n` +
                        `👥 **Cluster Activity:** **${otherWallets.length} other tracked wallets** bought this.\n` +
                        `⏳ *Note: Alert triggers only if they hold past the 3-minute mark.*\n` +
                        `📊 **Status:** ${probabilityScore}\n\n` +
                        `🔗 [Dexscreener](https://dexscreener.com/solana/${tokenMint}) | [Solscan](https://solscan.io/token/${tokenMint})`;

                    await sendDiscordAlert(message);
                }
            }
        }
    } catch (err) {
        console.error("Error processing transaction batch:", err);
    }
}