const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "https://discord.com/api/webhooks/1545746746242498620/LjsCpbblr-07w1Gi9GcQrTn39MspeX6sn8lnTbkvcFEJKKjG0x_gFS1QcYlD1eago97-";

// 1. YOUR LIST OF TRACKED WALLETS
const TRACKED_WALLETS = new Set([
    "GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ",
    // Add more Solana wallet addresses here
]);

// Persistent global cache for Vercel serverless instances
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
    // Only accept POST requests from Helius webhooks
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Respond instantly to Helius to prevent timeouts
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