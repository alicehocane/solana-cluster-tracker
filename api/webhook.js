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

global.tokenClusterCache = global.tokenClusterCache || new Map();
const TIME_WINDOW_MS = 30 * 60 * 1000; // 30 Minutes

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

        for (const tx of transactions) {
            if (tx.type !== 'SWAP') continue;

            const involvedTrackedWallet = tx.accountData?.find(acc => 
                TRACKED_WALLETS.has(acc.account) && acc.nativeBalanceChange < 0
            )?.account || tx.feePayer;

            if (!TRACKED_WALLETS.has(involvedTrackedWallet)) continue;

            const tokenTransfer = tx.tokenTransfers?.find(transfer => 
                transfer.toUserAccount === involvedTrackedWallet
            );

            if (!tokenTransfer) continue;

            const tokenMint = tokenTransfer.mint;

            // SKIP IF IT IS A BLACKLISTED TOKEN (SOL, USDC, USDT, etc.)
            if (BLACKLISTED_TOKENS.has(tokenMint)) continue;

            const now = Date.now();

            if (!global.tokenClusterCache.has(tokenMint)) {
                global.tokenClusterCache.set(tokenMint, []);
            }

            const buyers = global.tokenClusterCache.get(tokenMint);
            const recentBuyers = buyers.filter(b => now - b.timestamp < TIME_WINDOW_MS);

            if (!recentBuyers.some(b => b.wallet === involvedTrackedWallet)) {
                recentBuyers.push({ wallet: involvedTrackedWallet, timestamp: now });
            }

            global.tokenClusterCache.set(tokenMint, recentBuyers);

            const otherWallets = recentBuyers.filter(b => b.wallet !== involvedTrackedWallet);

            let probabilityScore = "Low 🧊";
            if (otherWallets.length >= 3) probabilityScore = "🔥 HIGH PUMP PROBABILITY 🔥";
            else if (otherWallets.length >= 1) probabilityScore = "⚡ Medium ⚡";

            const shortWallet = `${involvedTrackedWallet.slice(0, 4)}...${involvedTrackedWallet.slice(-4)}`;
            const shortToken = `${tokenMint.slice(0, 4)}...${tokenMint.slice(-4)}`;

            const message = 
                `🚨 **CONFLUENCE ALERT** 🚨\n\n` +
                `🪙 **Token:** \`${shortToken}\`\n` +
                `👤 **Buyer:** \`${shortWallet}\`\n` +
                `👥 **Cluster Activity:** **${otherWallets.length} other tracked wallets** bought this recently.\n` +
                `📊 **Status:** ${probabilityScore}\n\n` +
                `🔗 [Dexscreener](https://dexscreener.com/solana/${tokenMint}) | [Solscan](https://solscan.io/token/${tokenMint})`;

            if (otherWallets.length > 0) {
                await sendDiscordAlert(message);
            }
        }
    } catch (err) {
        console.error("Error processing transaction batch:", err);
    }
}